import * as THREE from 'three';
import { createWaxDebris } from './thin-wax-debris.mjs';

// Each centroid stays distinct. Only a repeated same-panel indexed edge may
// reuse its identical support/target midpoint query within this sync.
export function createWaxSweepSchedule(triangles) {
  const seen = new Set();
  return triangles.map(triangle => ({ triangle, edges: triangle.map((a, k) => {
    const b = triangle[(k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`, first = !seen.has(key); seen.add(key);
    return { a, b, first };
  }) }));
}

// Voronoi boundaries cut the original triangles in model space. Each generated
// point retains a barycentric source mapping, so shell contact and deformation
// use the same original surface even when the shell is built over an old dent.
function buildPanels(rest, index, count = 180) {
  // Random spacing produces deliberately unequal shards: no Fibonacci rows,
  // equal hexagons, or a repeated scale pattern. The seed is deterministic.
  let randomState = 0x38c1a7;
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; };
  const seeds = [];
  while (seeds.length < count) {
    const y = random() * 2 - 1, angle = random() * Math.PI * 2;
    const candidate = new THREE.Vector3(Math.sqrt(1 - y * y) * Math.cos(angle), y, Math.sqrt(1 - y * y) * Math.sin(angle));
    if (seeds.every(seed => seed.distanceToSquared(candidate) > .007)) seeds.push(candidate);
  }
  const nearby = seeds.map(s => seeds.map((t, j) => [j, s.distanceToSquared(t)]).sort((a, b) => a[1] - b[1]).map(x => x[0]));
  const planes = seeds.map(seed => seeds.map(other => other.clone().sub(seed)));
  const panels = seeds.map((seed, id) => ({ id, seed, vertices: [], triangles: [], sourceFaces: [], map: new Map(), cracked: false, detached: false, dead: false, lift: 0, born: 0, burst: false, offset: new THREE.Vector3(), outward: seed.clone() }));
  function clip(poly, plane) {
    const output = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = a.p.dot(plane), db = b.p.dot(plane), ina = da <= 1e-10, inb = db <= 1e-10;
      if (ina) output.push(a);
      if (ina !== inb) { const t = da / (da - db); output.push({ p: a.p.clone().lerp(b.p, t), weights: a.weights.map((w, k) => w + (b.weights[k] - w) * t), ids: a.ids, sourceFace: a.sourceFace }); }
    }
    return output;
  }
  for (let f = 0; f < index.length; f += 3) {
    const ids = Array.from(index.slice(f, f + 3)), points = ids.map(i => new THREE.Vector3().fromArray(rest, i * 3));
    const center = points[0].clone().add(points[1]).add(points[2]).normalize();
    let nearest = 0; for (let s = 1; s < seeds.length; s++) if (center.dot(seeds[s]) > center.dot(seeds[nearest])) nearest = s;
    const initial = points.map((p, k) => ({ p, ids, sourceFace: f / 3, weights: [+(k === 0), +(k === 1), +(k === 2)] }));
    // Random spacing invalidates fixed-neighbor guesses. This quick rejection
    // is conservative over the *whole source triangle*: a linear half-space
    // excluding all three corners excludes every point inside that triangle.
    // Every surviving cell is then clipped against every other seed.
    for (let s = 0; s < seeds.length; s++) {
      if (s !== nearest && points.every(p => p.dot(planes[s][nearest]) > 1e-10)) continue;
      let polygon = initial;
      for (const other of nearby[s]) {
        if (polygon.length < 3) break;
        if (other !== s) polygon = clip(polygon, planes[s][other]);
      }
      if (polygon.length < 3) continue;
      const panel = panels[s], local = polygon.map(vertex => {
        const key = vertex.p.toArray().map(x => Math.round(x * 1e7)).join(':');
        if (!panel.map.has(key)) { panel.map.set(key, panel.vertices.length); panel.vertices.push(vertex); }
        return panel.map.get(key);
      });
      for (let k = 1; k < local.length - 1; k++) if (new Set([local[0], local[k], local[k + 1]]).size === 3) { panel.triangles.push([local[0], local[k], local[k + 1]]); panel.sourceFaces.push(f / 3); }
    }
  }
  // A spatial Voronoi cone can intersect a nonconvex surface in disconnected
  // islands (notably both sides of a donut tube). Each island is a separate
  // physical plate; a detached body must never span empty space through a hole.
  let nextPanelId = count;
  const connectedPanels = [];
  for (const panel of panels) {
    if (!panel.triangles.length) continue;
    const incident = Array.from({ length: panel.vertices.length }, () => []);
    panel.triangles.forEach((triangle, t) => triangle.forEach(v => incident[v].push(t)));
    const visited = new Uint8Array(panel.triangles.length); let component = 0;
    for (let seed = 0; seed < panel.triangles.length; seed++) if (!visited[seed]) {
      const queue = [seed], triangles = []; visited[seed] = 1;
      while (queue.length) { const t = queue.pop(); triangles.push(t); for (const v of panel.triangles[t]) for (const neighbor of incident[v]) if (!visited[neighbor]) { visited[neighbor] = 1; queue.push(neighbor); } }
      if (triangles.length === panel.triangles.length) { connectedPanels.push({ ...panel, cellId: panel.id }); break; }
      const ids = [...new Set(triangles.flatMap(t => panel.triangles[t]))], remap = new Map(ids.map((v, i) => [v, i]));
      connectedPanels.push({ ...panel, id: component++ ? nextPanelId++ : panel.id, cellId: panel.id, vertices: ids.map(v => panel.vertices[v]), triangles: triangles.map(t => panel.triangles[t].map(v => remap.get(v))), sourceFaces: triangles.map(t => panel.sourceFaces[t]) });
    }
  }
  const splitSurface = connectedPanels.length !== panels.filter(p => p.triangles.length).length;
  const edgeOwners = new Map();
  const edgeKey = (panel, edge) => edge.map(i => panel.vertices[i].p.toArray().map(x => Math.round(x * 1e6)).join(':')).sort().join('|');
  if (splitSurface) for (const panel of connectedPanels) {
    const boundary = new Map();
    for (const tri of panel.triangles) for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`; if (boundary.has(key)) boundary.delete(key); else boundary.set(key, [a, b]); }
    for (const edge of boundary.values()) { const key = edgeKey(panel, edge); if (!edgeOwners.has(key)) edgeOwners.set(key, []); edgeOwners.get(key).push(panel.id); }
  }
  for (const panel of connectedPanels) {
    const edges = new Map();
    for (const tri of panel.triangles) for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`; if (edges.has(key)) edges.delete(key); else edges.set(key, [a, b]); }
    panel.boundary = [...edges.values()];
    // Join the tessellated perimeter into genuine long Voronoi edges. Damage
    // selects a few connected long edges; pre-cut cell rings stay invisible.
    const groups = new Map();
    for (const edge of panel.boundary) {
      const midpoint = panel.vertices[edge[0]].p.clone().add(panel.vertices[edge[1]].p).multiplyScalar(.5);
      let neighbor = -1, nearest = Infinity;
      for (let j = 0; j < seeds.length; j++) if (j !== panel.cellId) { const distance = Math.abs(midpoint.dot(planes[panel.cellId][j])) / planes[panel.cellId][j].length(); if (distance < nearest) { nearest = distance; neighbor = j; } }
      if (splitSurface) neighbor = edgeOwners.get(edgeKey(panel, edge))?.find(id => id !== panel.id) ?? -1;
      const key = splitSurface ? neighbor < 0 ? `boundary:${panel.id}:${edgeKey(panel, edge)}` : panel.id < neighbor ? `${panel.id}:${neighbor}` : `${neighbor}:${panel.id}` : panel.cellId < neighbor ? `${panel.cellId}:${neighbor}` : `${neighbor}:${panel.cellId}`;
      if (!groups.has(key)) groups.set(key, { key, neighbor, edges: [], center: new THREE.Vector3(), samples: 0 });
      const group = groups.get(key); group.edges.push(edge); group.center.add(midpoint); group.samples++;
    }
    panel.boundaryGroups = [...groups.values()]; for (const group of panel.boundaryGroups) group.center.multiplyScalar(1 / group.samples);
    panel.openVertexMask = new Uint8Array(panel.vertices.length);
    panel.boundaryVertexMask = new Uint8Array(panel.vertices.length); for (const [a, b] of panel.boundary) { panel.boundaryVertexMask[a] = 1; panel.boundaryVertexMask[b] = 1; }
    panel.area = panel.triangles.reduce((sum, [a, b, c]) => sum + panel.vertices[b].p.clone().sub(panel.vertices[a].p).cross(panel.vertices[c].p.clone().sub(panel.vertices[a].p)).length() * .5, 0);
    panel.center = new THREE.Vector3(); for (const vertex of panel.vertices) panel.center.add(vertex.p); panel.center.multiplyScalar(1 / panel.vertices.length);
    panel.pivot = panel.vertices[panel.boundary[0]?.[0] || 0]?.p.clone() || panel.center.clone();
    panel.axis = panel.seed.clone().cross(panel.pivot.clone().sub(panel.center)).normalize();
    panel.complexSurface = splitSurface;
    delete panel.map;
  }
  return connectedPanels;
}

export function createVoronoiWax({ geometry, restPositions, restNormals, color = '#eed3af', clock = () => performance.now() / 1000, reducedMotion = false, collectionEnabled = true } = {}, config, makeCollisionTree) {
  if (!geometry?.index || !geometry.attributes.normal) throw new TypeError('Thin wax requires indexed source geometry');
  const source = geometry.attributes.position.array, normals = geometry.attributes.normal.array;
  const rest = restPositions?.slice() || source.slice(), referenceNormals = restNormals?.slice() || normals.slice();
  if (rest.length !== source.length || referenceNormals.length !== normals.length) throw new RangeError('Thin wax original surface snapshot mismatch');
  let seedCount = 180, panels = buildPanels(rest, geometry.index.array);
  for (let attempt = 0; panels.length > config.maxFragments && attempt < 5; attempt++) {
    seedCount = Math.max(48, Math.floor(seedCount * config.maxFragments / panels.length * .95));
    panels = buildPanels(rest, geometry.index.array, seedCount);
  }
  if (panels.length > config.maxFragments) throw new RangeError('Wax surface cannot be split into connected plates within the fragment budget');
  const records = [], indices = [], sourceFaces = [];
  for (const panel of panels) panel.sweepSchedule = createWaxSweepSchedule(panel.triangles);
  for (const panel of panels) {
    const average = new THREE.Vector3(), localNormals = panel.vertices.map(vertex => {
      const normal = new THREE.Vector3(); for (let k = 0; k < 3; k++) normal.addScaledVector(new THREE.Vector3().fromArray(referenceNormals, vertex.ids[k] * 3), vertex.weights[k]);
      normal.normalize(); average.add(normal); return normal;
    });
    average.normalize(); panel.supportOnly = localNormals.some(normal => normal.dot(average) < .55);
  }
  for (const panel of panels) {
    panel.start = records.length;
    for (let i = 0; i < panel.vertices.length; i++) records.push({ panel, vertex: i, layer: 0 }, { panel, vertex: i, layer: 1 });
    for (let t = 0; t < panel.triangles.length; t++) { const [a, b, c] = panel.triangles[t], offset = panel.start; indices.push(offset + a * 2 + 1, offset + b * 2 + 1, offset + c * 2 + 1, offset + c * 2, offset + b * 2, offset + a * 2); sourceFaces.push(panel.sourceFaces[t], -1); }
    for (const edge of panel.boundary) {
      const start = records.length;
      records.push({ panel, vertex: edge[0], layer: 0, edge }, { panel, vertex: edge[1], layer: 0, edge }, { panel, vertex: edge[1], layer: 1, edge }, { panel, vertex: edge[0], layer: 1, edge });
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
      sourceFaces.push(-1, -1);
    }
    panel.end = records.length;
  }
  const shell = new THREE.BufferGeometry(), output = new Float32Array(records.length * 3), outputNormals = new Float32Array(output.length);
  shell.setAttribute('position', new THREE.BufferAttribute(output, 3).setUsage(THREE.DynamicDrawUsage));
  shell.setAttribute('normal', new THREE.BufferAttribute(outputNormals, 3).setUsage(THREE.DynamicDrawUsage)); shell.setIndex(indices);
  const colors = new Float32Array(output.length);
  for (let r = 0; r < records.length; r++) { const shade = records[r].edge ? .69 : records[r].layer ? 1 : .85; colors.fill(shade, r * 3, r * 3 + 3); }
  shell.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshStandardMaterial({ color, roughness: .64, metalness: 0, vertexColors: true });
  const mesh = new THREE.Mesh(shell, material); mesh.frustumCulled = false;
  const group = new THREE.Group(); group.name = 'Thin_Wax_Voronoi'; group.add(mesh);
  const collisions = makeCollisionTree(geometry, { nearestGrid: panels.some(panel => panel.complexSurface) });
  const visibleCrackEdges = new Set();
  const debris = createWaxDebris({ thickness: config.thickness, reducedMotion, collectionEnabled });
  const worldMatrix = new THREE.Matrix4(), worldInverse = new THREE.Matrix4(), worldLinear = new THREE.Matrix3();
  let worldRevision = 0;
  worldLinear.setFromMatrix4(worldMatrix);
  function setWorldMatrix(value) {
    const next = value?.isMatrix4 ? value : new THREE.Matrix4().fromArray(value);
    if (worldMatrix.equals(next)) return;
    worldMatrix.copy(next); worldInverse.copy(next).invert(); worldLinear.setFromMatrix4(next); worldRevision++; dirty = true;
  }
  let active = false, disposed = false, contact, anchor, since = 0, now = clock(), totalDetached = 0, dirty = true, sweepSamples = 0, sweepLogicalSamples = 0, zeroLengthSweepSamples = 0, attachedNearestSamples = 0, detachedNearestSamples = 0, stroke, chainWaves = 0, lastDamageTime = null, attachedCorrectionMax = 0, attachedCorrectionTotalMax = 0, attachedCorrectedSamples = 0;
  const point = value => Array.isArray(value) || ArrayBuffer.isView(value) ? new THREE.Vector3(...value) : new THREE.Vector3(value.x, value.y, value.z);
  const vec = () => new THREE.Vector3();
  function map(vertex, array, out) {
    out.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      const i = vertex.ids[k] * 3, w = vertex.weights[k];
      // Core normal recomputation must not expose hidden panel boundaries on
      // untouched skin. Preserve the authored normal where its source vertex
      // has not moved; the approved core renderer itself remains unchanged.
      const values = array === normals && source[i] === rest[i] && source[i + 1] === rest[i + 1] && source[i + 2] === rest[i + 2] ? referenceNormals : array;
      out.x += values[i] * w; out.y += values[i + 1] * w; out.z += values[i + 2] * w;
    }
    return out;
  }
  function localPanels(radius = .47) { return panels.filter(p => !p.detached && p.center.distanceTo(contact) < radius).sort((a, b) => a.center.distanceToSquared(contact) - b.center.distanceToSquared(contact)); }
  function crack() {
    // A tiny local starter crack; the connected brittle wave happens later.
    if (!stroke.starter) stroke.starter = localPanels(.32)[0];
    const panel = stroke.starter;
    if (panel && !panel.mainRing) { panel.cracked = true; panel.mainRing = true; for (const group of panel.boundaryGroups) visibleCrackEdges.add(group.key); refreshCrackMasks(); dirty = true; }
  }
  function refreshCrackMasks() {
    for (const panel of panels) {
      panel.openVertexMask.fill(0);
      for (const group of panel.boundaryGroups) if (visibleCrackEdges.has(group.key)) for (const [a, b] of group.edges) { panel.openVertexMask[a] = 1; panel.openVertexMask[b] = 1; }
    }
  }
  function openBranchNetwork(cohort) {
    const cohortIds = new Set(cohort.map(p => p.id)), reached = new Set([stroke.starter?.id ?? cohort[0]?.id]), degree = new Map();
    while (reached.size < cohortIds.size) {
      let best;
      for (const panel of cohort) if (!reached.has(panel.id)) for (const group of panel.boundaryGroups) if (cohortIds.has(group.neighbor) && reached.has(group.neighbor)) {
        const score = group.center.distanceToSquared(contact) + (degree.get(group.neighbor) || 0) * .05;
        if (!best || score < best.score) best = { panel, group, score };
      }
      if (!best) break;
      visibleCrackEdges.add(best.group.key); reached.add(best.panel.id);
      degree.set(best.panel.id, (degree.get(best.panel.id) || 0) + 1); degree.set(best.group.neighbor, (degree.get(best.group.neighbor) || 0) + 1);
    }
    refreshCrackMasks();
  }
  function depth() {
    const nearest = panels.reduce((a, b) => a.center.distanceToSquared(contact) < b.center.distanceToSquared(contact) ? a : b);
    let maximum = 0;
    for (const vertex of nearest.vertices) maximum = Math.max(maximum, vertex.p.clone().sub(map(vertex, source, vec())).length());
    return maximum;
  }
  function crackDeformedSurface() {
    if (!active) return;
    const current = vec(); let changed = false;
    for (const panel of panels) {
      if (panel.detached) continue;
      let displacement = 0;
      for (const vertex of panel.vertices) displacement = Math.max(displacement, map(vertex, source, current).distanceTo(vertex.p));
      if (displacement < config.visibleDeformation) continue;
      // Use the actual mapped core, including the dent rim and dragged trail.
      // A deformed cell opens only one or two stressed long edges, not its ring.
      const desired = displacement > .025 ? 2 : 1;
      if ((panel.strainEdges || 0) >= desired) continue;
      const ranked = panel.boundaryGroups.map(group => {
        let strain = 0;
        for (const edge of group.edges) for (const i of edge) strain = Math.max(strain, map(panel.vertices[i], source, current).distanceTo(panel.vertices[i].p));
        return { group, strain };
      }).sort((a, b) => b.strain - a.strain);
      for (const { group } of ranked.slice(0, desired)) visibleCrackEdges.add(group.key);
      panel.cracked = panel.strainCracked = true; panel.strainEdges = desired; changed = true;
    }
    if (changed) { refreshCrackMasks(); dirty = true; }
  }
  function startLocalStroke() { since = clock(); stroke = { fractured: false, cohort: [], pending: [], reserve: null, baselineDepth: 0, lastDropTime: 0, detachCount: 0 }; }
  function begin(value) { if (disposed) return; active = true; contact = anchor = point(value); startLocalStroke(); crack(); }
  function end() { active = false; contact = anchor = null; }
  function move(value) {
    if (!value) { end(); return; } if (!active) { begin(value); return; }
    contact = point(value); if (contact.distanceTo(anchor) > config.localRadius) { anchor = contact.clone(); startLocalStroke(); }
    crack();
  }
  function writePanel(panel, mapped) {
    const normal = vec(), base = vec(), wallNormal = vec(); let previousEdge;
    for (let r = panel.start; r < panel.end; r++) {
        const record = records[r], vertex = mapped[record.vertex]; normal.copy(vertex.renderedNormal); base.copy(vertex.rendered).addScaledVector(normal, record.layer * config.thickness);
        output[r * 3] = base.x; output[r * 3 + 1] = base.y; output[r * 3 + 2] = base.z;
        if (record.edge) {
          if (previousEdge !== record.edge) {
            const [a, b] = record.edge; previousEdge = record.edge;
            normal.copy(mapped[a].renderedNormal).add(mapped[b].renderedNormal).normalize();
            wallNormal.copy(mapped[b].rendered).sub(mapped[a].rendered).cross(normal).normalize();
          }
          normal.copy(wallNormal);
        } else if (record.layer === 0) normal.negate();
        outputNormals[r * 3] = normal.x; outputNormals[r * 3 + 1] = normal.y; outputNormals[r * 3 + 2] = normal.z;
      }
  }
  function renderDetached(panel, mapped) {
    let body = debris.get(panel.id);
    // Settled geometry is immutable in world space. Reuse its uploaded values
    // only while the transform is unchanged AND the live core cannot reach it.
    if (body?.settled && panel.renderedSettled && panel.renderWorldRevision === worldRevision && panel.renderBounds && !collisions.intersectsBox(panel.renderBounds)) return;
    if (!body) {
      const points = mapped.map(v => v.p.clone().addScaledVector(v.n, config.gap + .006).applyMatrix4(worldMatrix));
      const normals = mapped.map(v => v.n.clone().transformDirection(worldMatrix));
      body = debris.add(panel.id, points, normals, panel.triangles, now);
    }
    const worldPoints = debris.points(body, body.world), bounds = new THREE.Box3(), normal = vec();
    for (let i = 0; i < mapped.length; i++) {
      const vertex = mapped[i]; vertex.rendered ||= vec(); vertex.renderedNormal ||= vec();
      vertex.rendered.copy(worldPoints[i]).applyMatrix4(worldInverse);
      vertex.renderedNormal.copy(body.normals[i]).applyQuaternion(body.rotation).transformDirection(worldInverse);
      bounds.expandByPoint(vertex.rendered);
    }
    bounds.expandByScalar(config.thickness + .005);
    if (collisions.intersectsBox(bounds)) {
      // Translate the entire world-space chip out of the *current* live core.
      // Vertex, outer face, triangle center and edge samples stay rigid together.
      for (let attempt = 0; attempt < 10; attempt++) {
        let minimum = .003; const pushNormal = vec(), sample = point => {
          detachedNearestSamples++; const distance = collisions.signedDistance(point, normal);
          if (distance < minimum) { minimum = distance; pushNormal.copy(normal); }
        };
        for (const vertex of mapped) { sample(vertex.rendered); sample(vertex.rendered.clone().addScaledVector(vertex.renderedNormal, config.thickness)); }
        for (const triangle of panel.triangles) {
          const points = triangle.map(i => mapped[i].rendered);
          sample(points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3));
          for (let k = 0; k < 3; k++) sample(points[k].clone().add(points[(k + 1) % 3]).multiplyScalar(.5));
        }
        if (minimum >= .00299) break;
        const correction = pushNormal.multiplyScalar((.003 - minimum) * 1.15);
        for (const vertex of mapped) vertex.rendered.add(correction);
        const worldCorrection = correction.clone().applyMatrix3(worldLinear); body.position.add(worldCorrection);
        const direction = worldCorrection.clone().normalize(); body.velocity.addScaledVector(direction, -Math.min(0, body.velocity.dot(direction)));
      }
    }
    panel.renderBounds ||= new THREE.Box3(); panel.renderBounds.makeEmpty();
    for (const vertex of mapped) panel.renderBounds.expandByPoint(vertex.rendered);
    panel.renderBounds.expandByScalar(config.thickness + .005); panel.renderWorldRevision = worldRevision; panel.renderedSettled = body.settled;
    writePanel(panel, mapped);
  }
  function sync() {
    if (disposed) return; crackDeformedSurface(); collisions.refit(); sweepSamples = 0; sweepLogicalSamples = 0; zeroLengthSweepSamples = 0; attachedNearestSamples = 0; detachedNearestSamples = 0;
    const normal = vec(), base = vec(), tangent = vec(), original = vec();
    for (const panel of panels) {
      if (panel.dead) { for (let r = panel.start; r < panel.end; r++) output.fill(0, r * 3, r * 3 + 3); continue; }
      const mapped = panel.mapped ||= panel.vertices.map(() => ({ p: vec(), n: vec(), target: vec(), targetNormal: vec(), support: vec() }));
      if (panel.detached && debris.get(panel.id)) { renderDetached(panel, mapped); continue; }
      for (let i = 0; i < panel.vertices.length; i++) { map(panel.vertices[i], source, mapped[i].p); map(panel.vertices[i], normals, mapped[i].n).normalize(); mapped[i].support.copy(mapped[i].p).addScaledVector(mapped[i].n, config.gap); }
      const center = vec(); for (const vertex of mapped) center.add(vertex.p); center.multiplyScalar(1 / mapped.length);
      const outward = vec(); for (const vertex of mapped) outward.add(vertex.n); outward.normalize();
      if (panel.detached) { renderDetached(panel, mapped); continue; }
      // Damage-only controlled hinge lift. Resting cells receive *no* inset,
      // hinge, faceting or per-cell normal changes: all hidden seams coincide.
      const hinge = panel.cracked ? panel.lift : 0;
      const orientation = new THREE.Quaternion().setFromUnitVectors(panel.seed, outward);
      const pivot = panel.pivot.clone().sub(panel.center).applyQuaternion(orientation).add(center);
      const hingeRotation = new THREE.Quaternion().setFromAxisAngle(panel.axis.clone().applyQuaternion(orientation), hinge);
      let safetyLift = 0;
      for (let i = 0; i < mapped.length; i++) {
        const vertex = mapped[i];
        if (panel.cracked && panel.loose && !panel.supportOnly) {
          vertex.target.copy(panel.vertices[i].p).sub(panel.center).applyQuaternion(orientation).add(center).sub(pivot).applyQuaternion(hingeRotation).add(pivot);
          map(panel.vertices[i], referenceNormals, vertex.targetNormal).normalize().applyQuaternion(orientation).applyQuaternion(hingeRotation);
          const normalProjection = vertex.targetNormal.dot(vertex.n);
          safetyLift = Math.max(safetyLift, (vertex.p.clone().sub(vertex.target).dot(vertex.n) + config.gap * (1 - normalProjection) + .0003) / Math.max(.25, outward.dot(vertex.n)));
        } else {
          vertex.target.copy(vertex.p); vertex.targetNormal.copy(vertex.n);
          if (panel.cracked && panel.openVertexMask[i]) vertex.target.addScaledVector(vertex.n, Math.min(.004, hinge * panel.vertices[i].p.distanceTo(panel.pivot) * .3));
        }
      }
      for (let i = 0; i < mapped.length; i++) {
        const vertex = mapped[i];
        if (panel.cracked) {
          if (panel.loose || panel.openVertexMask[i]) vertex.target.addScaledVector(outward, safetyLift + .0008);
          // Bound shards keep their unbroken bridges. Only explicitly selected
          // perimeter chains open; whole-cell shrinking produced a scale mosaic.
          if (panel.loose || panel.openVertexMask[i]) {
            tangent.copy(center).sub(vertex.target).addScaledVector(vertex.targetNormal, -tangent.dot(vertex.targetNormal));
            const opening = panel.fractureAt === undefined ? (panel.strainCracked ? .0035 : .002) : .0055;
            if (tangent.length() > .0001) tangent.setLength(Math.min(opening, tangent.length() * .035)); vertex.target.add(tangent);
          }
        }
        vertex.target.addScaledVector(vertex.targetNormal, config.gap);
      }
      let fraction = 1;
      if (panel.cracked) {
        const constrain = (support, target) => {
          sweepLogicalSamples++;
          if (target.equals(support)) { zeroLengthSweepSamples++; return; }
          const displacement = target.clone().sub(support), length = displacement.length();
          const distance = collisions.sweep(support, displacement); sweepSamples++;
          if (distance < length - 1e-6) fraction = Math.min(fraction, Math.max(0, distance - config.thickness * 2) / length);
        };
        for (const vertex of mapped) constrain(vertex.support, vertex.target);
        for (const sample of panel.sweepSchedule) {
          const tri = sample.triangle;
          if (mapped[tri[0]].support.equals(mapped[tri[0]].target) && mapped[tri[1]].support.equals(mapped[tri[1]].target) && mapped[tri[2]].support.equals(mapped[tri[2]].target)) { sweepLogicalSamples += 4; zeroLengthSweepSamples++; for (const edge of sample.edges) if (edge.first) zeroLengthSweepSamples++; continue; }
          const supports = tri.map(i => mapped[i].support), targets = tri.map(i => mapped[i].target);
          constrain(supports[0].clone().add(supports[1]).add(supports[2]).multiplyScalar(1 / 3), targets[0].clone().add(targets[1]).add(targets[2]).multiplyScalar(1 / 3));
          for (const edge of sample.edges) {
            if (edge.first) constrain(mapped[edge.a].support.clone().add(mapped[edge.b].support).multiplyScalar(.5), mapped[edge.a].target.clone().add(mapped[edge.b].target).multiplyScalar(.5));
            else sweepLogicalSamples++;
          }
        }
      }
      for (const vertex of mapped) {
        vertex.rendered ||= vec(); vertex.renderedNormal ||= vec(); vertex.rendered.copy(vertex.support).lerp(vertex.target, fraction); vertex.renderedNormal.copy(vertex.n).lerp(vertex.targetNormal, fraction).normalize();
        // A true tangent crack on a curved/nonconvex patch must retain the
        // source-normal clearance. This no-op for safe vertices keeps the
        // original orb path unchanged while protecting thin connections.
        const clearance = vertex.rendered.clone().sub(vertex.p).dot(vertex.n);
        if (clearance < config.gap - .000001) vertex.rendered.addScaledVector(vertex.n, config.gap - clearance + .000001);
      }
      if (panel.complexSurface && mapped.some((vertex, i) => vertex.p.distanceToSquared(panel.vertices[i].p) > 1e-14)) {
        const beforeCorrection = mapped.map(vertex => vertex.rendered.clone());
        // A deep concave connection can intersect a fracture wall even when
        // every inner support vertex has positive clearance. Correct only the
        // affected attached edge vertices using the actual nearest core face.
        const hitNormal = vec();
        for (let attempt = 0; attempt < 4; attempt++) {
          let changed = false;
          for (const edge of panel.boundary) {
            const [a, b] = edge;
            const va = mapped[a], vb = mapped[b];
            edge.nearestHints ||= [{ faceIndex: panel.vertices[a].sourceFace }, { faceIndex: panel.vertices[a].sourceFace }];
            for (let site = 0; site < 2; site++) {
              const weight = (site + 1) / 3;
              const sample = va.rendered.clone().lerp(vb.rendered, weight).addScaledVector(va.renderedNormal.clone().lerp(vb.renderedNormal, weight).normalize(), config.thickness * weight);
              attachedNearestSamples++; const distance = collisions.signedDistance(sample, hitNormal, edge.nearestHints[site]);
              if (distance < .0005) {
                const shift = hitNormal.clone().multiplyScalar(.0008 - distance);
                attachedCorrectionMax = Math.max(attachedCorrectionMax, shift.length()); attachedCorrectedSamples++;
                for (const vertex of [va, vb]) {
                  vertex.rendered.add(shift); const clearance = vertex.rendered.clone().sub(vertex.p).dot(vertex.n);
                  if (clearance < config.gap) vertex.rendered.addScaledVector(vertex.n, config.gap - clearance + .000001);
                }
                changed = true;
              }
            }
          }
          for (const triangle of panel.triangles) {
            const affected = triangle.map(i => mapped[i]), sample = affected[0].rendered.clone().add(affected[1].rendered).add(affected[2].rendered).multiplyScalar(1 / 3);
            triangle.nearestHint ||= { faceIndex: panel.vertices[triangle[0]].sourceFace };
            attachedNearestSamples++; const distance = collisions.signedDistance(sample, hitNormal, triangle.nearestHint);
            if (distance < .0005) {
              const shift = hitNormal.clone().multiplyScalar(.0008 - distance);
              attachedCorrectionMax = Math.max(attachedCorrectionMax, shift.length()); attachedCorrectedSamples++;
              for (const vertex of affected) {
                vertex.rendered.add(shift); const clearance = vertex.rendered.clone().sub(vertex.p).dot(vertex.n);
                if (clearance < config.gap) vertex.rendered.addScaledVector(vertex.n, config.gap - clearance + .000001);
              }
              changed = true;
            }
          }
          if (!changed) break;
        }
        for (let i = 0; i < mapped.length; i++) attachedCorrectionTotalMax = Math.max(attachedCorrectionTotalMax, mapped[i].rendered.distanceTo(beforeCorrection[i]));
      }
      writePanel(panel, mapped);
    }
    shell.attributes.position.needsUpdate = true; shell.attributes.normal.needsUpdate = true; dirty = false;
  }
  function step(dt, time = clock()) {
    if (disposed) return { changed: false, needsFrame: false }; now = time;
    function detach(batch, burst) {
      let living = panels.filter(p => p.detached && !p.dead && !debris.get(p.id)?.settled).length;
      for (let b = 0; b < batch.length; b++) {
        const panel = batch[b];
        if (totalDetached >= Math.min(config.maxFragments, panels.length) || living >= config.maxLivingFragments) break;
        if (panel.detached) continue;
        panel.cracked = panel.detached = true; panel.born = now; panel.burst = burst; totalDetached++; living++; stroke.detachCount++; dirty = true; lastDamageTime = now;
        panel.outward.set(0, 0, 0); for (const vertex of panel.vertices) panel.outward.add(map(vertex, normals, vec())); panel.outward.normalize();
      }
    }
    if (active && now - since > config.dwell && !stroke.fractured) {
      stroke.fractured = true; stroke.baselineDepth = depth(); stroke.lastDropTime = now; stroke.cohort = localPanels(.53).slice(0, 9); chainWaves++; lastDamageTime = now;
      const eligible = [...stroke.cohort].sort((a, b) => a.area - b.area);
      const first = eligible.slice(0, 3);
      stroke.pending = eligible.slice(first.length); stroke.reserve = stroke.pending[0] || null;
      for (let i = 0; i < stroke.cohort.length; i++) {
        const panel = stroke.cohort[i]; panel.cracked = true; panel.fractureAt ??= now + i * .007; panel.retained = !first.includes(panel) && panel !== stroke.reserve; panel.loose = panel === stroke.reserve; dirty = true;
      }
      openBranchNetwork(stroke.cohort);
      detach(first, true);
      // A full live-fragment budget defers release; it must not strand a cell.
      stroke.pending.unshift(...first.filter(p => !p.detached)); stroke.reserve = stroke.pending[0] || null;
    }
    // Additional chips require *new core strain*. A stationary held timer may
    // finish the crack wave but cannot empty the contact footprint piece by piece.
    if (active && stroke.fractured && !stroke.reserve && depth() - stroke.baselineDepth > config.extraFractureStrain) {
      // Continue into the actually deformed rim, rather than stopping at nine
      // original candidates. An untouched cell cannot join from elapsed time.
      const next = localPanels(.75).find(p => p.strainCracked && !stroke.cohort.includes(p));
      if (next) {
        next.loose = true; next.retained = false; next.fractureAt = now;
        stroke.cohort.push(next); stroke.pending.push(next); stroke.reserve = next; dirty = true;
      }
    }
    if (active && stroke.fractured && stroke.reserve && now - stroke.lastDropTime > config.extraFractureDelay && depth() - stroke.baselineDepth > config.extraFractureStrain && stroke.detachCount < config.maxLocalFragments) {
      detach([stroke.reserve], false);
      if (stroke.reserve.detached) {
        stroke.baselineDepth = depth(); stroke.lastDropTime = now; stroke.pending.shift(); stroke.reserve = stroke.pending[0] || null;
        if (stroke.reserve) { stroke.reserve.loose = true; stroke.reserve.retained = false; }
      }
    }
    let living = false;
    for (const panel of panels) {
      if (active && panel.cracked && !panel.detached && panel.fractureAt !== undefined) {
        const age = now - panel.fractureAt;
        const variation = .55 + (Math.sin(panel.id * 73.1) + 1) * .225;
        const settled = .035 * variation, snap = age < 0 ? 0 : (reducedMotion ? .018 : .07) * Math.sin(Math.min(1, age / .055) * Math.PI) * Math.exp(-age / .09);
        const lift = age < 0 ? 0 : settled * Math.min(1, age / .035) + snap;
        if (Math.abs(lift - panel.lift) > .00001) { panel.lift = lift; dirty = true; }
      }
    }
    const falling = debris.advance(dt, now);
    for (const id of debris.drainExpired()) { const panel = panels.find(p => p.id === id); if (panel) { panel.dead = true; panel.frozen = null; panel.mapped = null; panel.renderBounds = null; dirty = true; } }
    if (falling) dirty = living = true;

    const changed = dirty; if (changed) sync(); return { changed, needsFrame: active || living };
  }
  function reset() { end(); debris.reset(); attachedCorrectionMax = 0; attachedCorrectionTotalMax = 0; attachedCorrectedSamples = 0; totalDetached = 0; chainWaves = 0; lastDamageTime = null; visibleCrackEdges.clear(); for (const p of panels) { p.cracked = p.detached = p.dead = p.retained = p.loose = p.mainRing = p.strainCracked = false; p.strainEdges = 0; p.openVertexMask.fill(0); p.fractureAt = undefined; p.lift = 0; p.frozen = null; p.offset.set(0, 0, 0); } dirty = true; sync(); }
  function getState() { return { active, cracked: panels.filter(p => p.cracked).length, attachedCracked: panels.filter(p => p.cracked && !p.detached).length, attachedPartialBranches: panels.filter(p => p.cracked && !p.detached && !p.loose && p.boundaryGroups.some(g => visibleCrackEdges.has(g.key)) && !p.boundaryGroups.every(g => visibleCrackEdges.has(g.key))).length, visibleLongCrackEdges: visibleCrackEdges.size, detached: totalDetached, living: panels.filter(p => p.detached && !p.dead && !debris.get(p.id)?.settled).length, settled: debris.state().settled, expired: panels.filter(p => p.dead).length, collectionEnabled: debris.isCollectionEnabled(), debris: debris.state(), firstBurst: panels.filter(p => p.detached && p.burst).length, burstDuration: .07, burstInitialOutwardSpeed: 0, maxOutwardOffset: Math.max(0, ...panels.filter(p => p.detached && !p.dead).map(p => p.offset.dot(p.outward))), dwell: active ? Math.max(0, now - since) : 0, disposed, topology: 'random-spaced-clipped-voronoi', panels: panels.length, visibleCrackRadius: .53, localDamaged: stroke?.cohort.length || 0, localDetached: stroke?.detachCount || 0, chainWaveCount: chainWaves, lastDamageTime, heldStrain: active && stroke?.fractured ? depth() - stroke.baselineDepth : 0, maxDetachedPerContact: config.maxLocalFragments, localRetainedFraction: stroke?.cohort.length ? stroke.cohort.filter(p => !p.detached).length / stroke.cohort.length : 1 }; }
  function getMetrics({ exhaustive = false } = {}) {
    let minGap = Infinity, minSigned = Infinity, maxThicknessError = 0, attachedSamples = 0, attachedSurfaceSamples = 0, attachedViolations = 0, detachedSamples = 0, detachedInteriorSamples = 0, detachedMin = Infinity, detachedViolations = 0, wallSamples = 0;
    const normal = vec(), sourcePoint = vec(); let currentPanelId, worstAttachedSample = null;
    const sample = (position, detached, interior = false) => {
      const distance = collisions.signedDistance(position);
      if (detached) { detachedMin = Math.min(detachedMin, distance); if (interior) detachedInteriorSamples++; else detachedSamples++; if (distance < -.00001) detachedViolations++; }
      else { if (distance < minSigned) worstAttachedSample = { panelId: currentPanelId, point: position.toArray(), distance }; minSigned = Math.min(minSigned, distance); attachedSurfaceSamples++; if (distance < -.00001) attachedViolations++; }
    };
    for (const panel of panels) if (!panel.dead) {
      currentPanelId = panel.id;
      for (let i = 0; i < panel.vertices.length; i++) {
        const r = panel.start + i * 2, inner = vec().fromArray(output, r * 3), outer = vec().fromArray(output, (r + 1) * 3);
        if (panel.detached) sample(inner, true);
        else { map(panel.vertices[i], source, sourcePoint); map(panel.vertices[i], normals, normal).normalize(); const gap = inner.clone().sub(sourcePoint).dot(normal); minGap = Math.min(minGap, gap); attachedSamples++; if (gap < config.gap - .00001) attachedViolations++; }
        maxThicknessError = Math.max(maxThicknessError, Math.abs(outer.distanceTo(inner) - config.thickness));
      }
      const stride = exhaustive || panel.detached ? 1 : Math.max(1, Math.ceil(panel.triangles.length / 4));
      for (let t = 0; t < panel.triangles.length; t += stride) {
        const points = panel.triangles[t].map(i => vec().fromArray(output, (panel.start + i * 2) * 3));
        sample(points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3), panel.detached, true);
        for (let k = 0; k < 3; k++) sample(points[k].clone().add(points[(k + 1) % 3]).multiplyScalar(.5), panel.detached, true);
      }
      for (let r = panel.start + panel.vertices.length * 2; r < panel.end; r += 4) {
        const a = vec().fromArray(output, r * 3), b = vec().fromArray(output, (r + 1) * 3), c = vec().fromArray(output, (r + 2) * 3), d = vec().fromArray(output, (r + 3) * 3);
        sample(a.clone().add(b).add(c).multiplyScalar(1 / 3), panel.detached, true);
        sample(a.clone().add(c).add(d).multiplyScalar(1 / 3), panel.detached, true); wallSamples += 2;
      }
    }
    const areas = panels.map(p => p.area), averageArea = areas.reduce((a, b) => a + b, 0) / areas.length;
    const panelAreaCV = Math.sqrt(areas.reduce((sum, area) => sum + (area - averageArea) ** 2, 0) / areas.length) / averageArea;
    return { thickness: config.thickness, gap: config.gap, tolerance: .00001, attachedMinGap: minGap, attachedMinSignedDistance: minSigned, worstAttachedSample, attachedCorrectionMax, attachedCorrectionTotalMax, attachedCorrectedSamples, maxThicknessError, attachedSamples, attachedSurfaceSamples, attachedViolations, detachedSweepSamples: sweepSamples, logicalSweepSamples: sweepLogicalSamples, zeroLengthSweepSamples, duplicateSweepSamples: sweepLogicalSamples - sweepSamples - zeroLengthSweepSamples, detachedMinSignedDistance: Number.isFinite(detachedMin) ? detachedMin : null, detachedSamples, detachedInteriorSamples, detachedViolations, wallSamples, drawCalls: 1, shellVertices: records.length, shellTriangles: indices.length / 3, patches: panels.length, debris: debris.state(), panelAreaCV, panelAreaRange: [Math.min(...areas), Math.max(...areas)], method: 'Random-spaced Voronoi-clipped original triangles; majority bound cracked support, frozen rigid detached templates; dynamic BVH sweeps and signed vertex/face/edge/wall checks' };
  }
  function dispose() { if (disposed) return; end(); debris.reset(); disposed = true; shell.dispose(); material.dispose(); group.removeFromParent(); }
  function getSurfaceSnapshot() {
    const worldPositions = new Float32Array(output.length), worldNormals = new Float32Array(output.length), settled = new Uint8Array(records.length), supports = new Float32Array(output.length), sourceSupports = new Float32Array(output.length), sourceUnmoved = new Uint8Array(records.length), damage = new Uint8Array(records.length), referenceNormal = new Float32Array(output.length), layers = new Int8Array(records.length), panelIds = new Uint16Array(records.length), detached = new Uint8Array(records.length), loose = new Uint8Array(records.length), boundaryVertex = new Uint8Array(records.length), openBoundary = new Uint8Array(records.length);
    const support = vec(), normal = vec();
    for (let r = 0; r < records.length; r++) {
      const record = records[r], vertex = record.panel.vertices[record.vertex];
      sourceUnmoved[r] = +vertex.ids.every(id => source[id * 3] === rest[id * 3] && source[id * 3 + 1] === rest[id * 3 + 1] && source[id * 3 + 2] === rest[id * 3 + 2]);
      const worldPoint = vec().fromArray(output, r * 3).applyMatrix4(worldMatrix), worldNormal = vec().fromArray(outputNormals, r * 3).transformDirection(worldMatrix);
      worldPositions.set(worldPoint.toArray(), r * 3); worldNormals.set(worldNormal.toArray(), r * 3); settled[r] = +Boolean(debris.get(record.panel.id)?.settled);
      map(vertex, rest, support); map(vertex, referenceNormals, normal).normalize();
      supports.set(support.toArray(), r * 3); map(vertex, source, support); sourceSupports.set(support.toArray(), r * 3); referenceNormal.set(normal.toArray(), r * 3); damage[r] = +record.panel.cracked; layers[r] = record.edge ? -1 : record.layer; panelIds[r] = record.panel.id; detached[r] = +(record.panel.detached && !record.panel.dead);
      loose[r] = +record.panel.loose; boundaryVertex[r] = record.panel.boundaryVertexMask[record.vertex]; openBoundary[r] = record.panel.openVertexMask[record.vertex];
    }
    return { worldPositions, worldNormals, settled, positions: output.slice(), normals: outputNormals.slice(), colors: colors.slice(), indices: shell.index.array.slice(), sourceFaces: Int32Array.from(sourceFaces), restSupportPositions: supports, sourceSupportPositions: sourceSupports, sourceUnmoved, restSupportNormals: referenceNormal, damage, layers, panelIds, detached, loose, boundaryVertex, openBoundary };
  }
  sync();
  return { group, begin, move, end, release: end, cancel: end, sync, step, reset, dispose, getState, getMetrics, getSurfaceSnapshot, getQueryCounters(enable = false) { return { ...collisions.getQueryCounters(enable), attachedNearestSamples, detachedNearestSamples, logicalSweepSamples: sweepLogicalSamples, actualSweepQueries: sweepSamples, zeroLengthSweepSamples, duplicateSweepSamples: sweepLogicalSamples - sweepSamples - zeroLengthSweepSamples }; }, setWorldMatrix, setCollectionEnabled(value) { debris.setCollectionEnabled(value); dirty = true; }, setGravity(value) { if (point(value).normalize().distanceTo(new THREE.Vector3(0, -1, 0)) > 1e-6) throw new RangeError('Wax debris gravity is world down; rotate the core with setWorldMatrix'); }, setReducedMotion(value) { reducedMotion = !!value; debris.setReducedMotion(value); } };
}
