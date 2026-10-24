import * as THREE from 'three';

// Voronoi boundaries cut the original triangles in model space. Each generated
// point retains a barycentric source mapping, so shell contact and deformation
// use the same original surface even when the shell is built over an old dent.
function buildPanels(rest, index, count = 144) {
  const seeds = Array.from({ length: count }, (_, i) => {
    const y = 1 - 2 * (i + .5) / count, angle = i * 2.399963229728653 + Math.sin(i * 17.13) * .14;
    return new THREE.Vector3(Math.sqrt(1 - y * y) * Math.cos(angle), y, Math.sqrt(1 - y * y) * Math.sin(angle));
  });
  const nearby = seeds.map((s, i) => seeds.map((t, j) => [j, s.distanceToSquared(t)]).sort((a, b) => a[1] - b[1]).slice(0, 22).map(x => x[0]));
  const panels = seeds.map((seed, id) => ({ id, seed, vertices: [], triangles: [], map: new Map(), cracked: false, detached: false, dead: false, lift: 0, born: 0, burst: false, offset: new THREE.Vector3(), outward: seed.clone() }));
  function clip(poly, plane) {
    const output = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], da = a.p.dot(plane), db = b.p.dot(plane), ina = da <= 1e-10, inb = db <= 1e-10;
      if (ina) output.push(a);
      if (ina !== inb) { const t = da / (da - db); output.push({ p: a.p.clone().lerp(b.p, t), weights: a.weights.map((w, k) => w + (b.weights[k] - w) * t), ids: a.ids }); }
    }
    return output;
  }
  for (let f = 0; f < index.length; f += 3) {
    const ids = Array.from(index.slice(f, f + 3)), points = ids.map(i => new THREE.Vector3().fromArray(rest, i * 3));
    const center = points[0].clone().add(points[1]).add(points[2]).normalize();
    let nearest = 0; for (let s = 1; s < seeds.length; s++) if (center.dot(seeds[s]) > center.dot(seeds[nearest])) nearest = s;
    const initial = points.map((p, k) => ({ p, ids, weights: [+(k === 0), +(k === 1), +(k === 2)] }));
    for (const s of nearby[nearest].slice(0, 12)) {
      let polygon = initial;
      for (const other of nearby[s]) if (other !== s && polygon.length >= 3) polygon = clip(polygon, seeds[other].clone().sub(seeds[s]));
      if (polygon.length < 3) continue;
      const panel = panels[s], local = polygon.map(vertex => {
        const key = vertex.p.toArray().map(x => Math.round(x * 1e7)).join(':');
        if (!panel.map.has(key)) { panel.map.set(key, panel.vertices.length); panel.vertices.push(vertex); }
        return panel.map.get(key);
      });
      for (let k = 1; k < local.length - 1; k++) if (new Set([local[0], local[k], local[k + 1]]).size === 3) panel.triangles.push([local[0], local[k], local[k + 1]]);
    }
  }
  for (const panel of panels) {
    const edges = new Map();
    for (const tri of panel.triangles) for (let k = 0; k < 3; k++) { const a = tri[k], b = tri[(k + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`; if (edges.has(key)) edges.delete(key); else edges.set(key, [a, b]); }
    panel.boundary = [...edges.values()];
    panel.center = new THREE.Vector3(); for (const vertex of panel.vertices) panel.center.add(vertex.p); panel.center.multiplyScalar(1 / panel.vertices.length);
    panel.pivot = panel.vertices[panel.boundary[0]?.[0] || 0]?.p.clone() || panel.center.clone();
    panel.axis = panel.seed.clone().cross(panel.pivot.clone().sub(panel.center)).normalize();
    delete panel.map;
  }
  return panels.filter(p => p.triangles.length);
}

export function createVoronoiWax({ geometry, restPositions, restNormals, color = '#eed3af', clock = () => performance.now() / 1000, reducedMotion = false } = {}, config, makeCollisionTree) {
  if (!geometry?.index || !geometry.attributes.normal) throw new TypeError('Thin wax requires indexed source geometry');
  const source = geometry.attributes.position.array, normals = geometry.attributes.normal.array;
  const rest = restPositions?.slice() || source.slice(), referenceNormals = restNormals?.slice() || normals.slice();
  if (rest.length !== source.length || referenceNormals.length !== normals.length) throw new RangeError('Thin wax original surface snapshot mismatch');
  const panels = buildPanels(rest, geometry.index.array), records = [], indices = [];
  for (const panel of panels) {
    panel.start = records.length;
    for (let i = 0; i < panel.vertices.length; i++) records.push({ panel, vertex: i, layer: 0 }, { panel, vertex: i, layer: 1 });
    for (const [a, b, c] of panel.triangles) { const offset = panel.start; indices.push(offset + a * 2 + 1, offset + b * 2 + 1, offset + c * 2 + 1, offset + c * 2, offset + b * 2, offset + a * 2); }
    for (const edge of panel.boundary) {
      const start = records.length;
      records.push({ panel, vertex: edge[0], layer: 0, edge }, { panel, vertex: edge[1], layer: 0, edge }, { panel, vertex: edge[1], layer: 1, edge }, { panel, vertex: edge[0], layer: 1, edge });
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    panel.end = records.length;
  }
  const shell = new THREE.BufferGeometry(), output = new Float32Array(records.length * 3), outputNormals = new Float32Array(output.length);
  shell.setAttribute('position', new THREE.BufferAttribute(output, 3).setUsage(THREE.DynamicDrawUsage));
  shell.setAttribute('normal', new THREE.BufferAttribute(outputNormals, 3).setUsage(THREE.DynamicDrawUsage)); shell.setIndex(indices);
  const colors = new Float32Array(output.length);
  for (let r = 0; r < records.length; r++) { const shade = records[r].edge ? .78 : records[r].layer ? 1 : .88; colors.fill(shade, r * 3, r * 3 + 3); }
  shell.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshStandardMaterial({ color, roughness: .64, metalness: 0, vertexColors: true });
  const mesh = new THREE.Mesh(shell, material); mesh.frustumCulled = false;
  const group = new THREE.Group(); group.name = 'Thin_Wax_Voronoi'; group.add(mesh);
  const collisions = makeCollisionTree(geometry), gravity = new THREE.Vector3(0, -1, 0);
  let active = false, disposed = false, contact, anchor, since = 0, lastDrop = 0, now = clock(), totalDetached = 0, dirty = true, sweepSamples = 0;
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
    // A single local ring plus two branches. Never reveal global Voronoi cells.
    for (const panel of localPanels(.4).slice(0, 3)) { panel.cracked = true; dirty = true; }
  }
  function begin(value) { if (disposed) return; active = true; contact = anchor = point(value); since = lastDrop = clock(); crack(); }
  function end() { active = false; contact = anchor = null; }
  function move(value) {
    if (!value) { end(); return; } if (!active) { begin(value); return; }
    contact = point(value); if (contact.distanceTo(anchor) > config.localRadius) { anchor = contact.clone(); since = lastDrop = clock(); }
    crack();
  }
  function sync() {
    if (disposed) return; collisions.refit(); sweepSamples = 0;
    const normal = vec(), base = vec(), tangent = vec(), original = vec();
    for (const panel of panels) {
      if (panel.dead) { for (let r = panel.start; r < panel.end; r++) output.fill(0, r * 3, r * 3 + 3); continue; }
      const mapped = panel.mapped ||= panel.vertices.map(() => ({ p: vec(), n: vec(), target: vec(), targetNormal: vec(), support: vec() }));
      for (let i = 0; i < panel.vertices.length; i++) { map(panel.vertices[i], source, mapped[i].p); map(panel.vertices[i], normals, mapped[i].n).normalize(); mapped[i].support.copy(mapped[i].p).addScaledVector(mapped[i].n, config.gap); }
      const center = vec(); for (const vertex of mapped) center.add(vertex.p); center.multiplyScalar(1 / mapped.length);
      const outward = vec(); for (const vertex of mapped) outward.add(vertex.n); outward.normalize();
      // Damage-only controlled hinge lift. Resting cells receive *no* inset,
      // hinge, faceting or per-cell normal changes: all hidden seams coincide.
      const hinge = panel.cracked ? panel.lift : 0;
      const orientation = new THREE.Quaternion().setFromUnitVectors(panel.seed, outward);
      const pivot = panel.pivot.clone().sub(panel.center).applyQuaternion(orientation).add(center);
      const hingeRotation = new THREE.Quaternion().setFromAxisAngle(panel.axis.clone().applyQuaternion(orientation), hinge);
      let safetyLift = 0;
      for (let i = 0; i < mapped.length; i++) {
        const vertex = mapped[i];
        if (panel.cracked) {
          vertex.target.copy(panel.vertices[i].p).sub(panel.center).applyQuaternion(orientation).add(center).sub(pivot).applyQuaternion(hingeRotation).add(pivot);
          map(panel.vertices[i], referenceNormals, vertex.targetNormal).normalize().applyQuaternion(orientation).applyQuaternion(hingeRotation);
          const normalProjection = vertex.targetNormal.dot(vertex.n);
          safetyLift = Math.max(safetyLift, (vertex.p.clone().sub(vertex.target).dot(vertex.n) + config.gap * (1 - normalProjection) + .0003) / Math.max(.25, outward.dot(vertex.n)));
        } else { vertex.target.copy(vertex.p); vertex.targetNormal.copy(vertex.n); }
      }
      if (panel.detached && panel.frozen) for (let i = 0; i < mapped.length; i++) { mapped[i].target.copy(panel.frozen[i].p); mapped[i].targetNormal.copy(panel.frozen[i].n); }
      else for (const vertex of mapped) {
        if (panel.cracked) {
          vertex.target.addScaledVector(outward, safetyLift + .0008);
          tangent.copy(center).sub(vertex.target).addScaledVector(vertex.targetNormal, -tangent.dot(vertex.targetNormal));
          if (tangent.length() > .0001) tangent.setLength(Math.min(.0024, tangent.length() * .018)); vertex.target.add(tangent);
        }
        vertex.target.addScaledVector(vertex.targetNormal, config.gap);
      }
      if (panel.detached && !panel.frozen) panel.frozen = mapped.map(vertex => ({ p: vertex.target.clone(), n: vertex.targetNormal.clone() }));
      for (const vertex of mapped) vertex.target.add(panel.offset);
      if (panel.detached) {
        // A detached plate stays rigid. Its whole frozen template receives one
        // conservative support-plane correction, never per-vertex snapping to
        // a recovering core. The accepted scope is the radial clay orb only.
        let correction = 0;
        for (const vertex of mapped) correction = Math.max(correction, (vertex.support.clone().sub(vertex.target).dot(vertex.n) + .003) / Math.max(.25, panel.outward.dot(vertex.n)));
        if (correction > 0) for (const vertex of mapped) vertex.target.addScaledVector(panel.outward, correction);
      }
      let fraction = 1;
      if (panel.cracked) {
        const constrain = (support, target) => {
          const displacement = target.clone().sub(support), length = displacement.length();
          const distance = collisions.sweep(support, displacement); sweepSamples++;
          if (distance < length - 1e-6) fraction = Math.min(fraction, Math.max(0, distance - config.thickness * 2) / length);
        };
        for (const vertex of mapped) constrain(vertex.support, vertex.target);
        for (const tri of panel.triangles) {
          const supports = tri.map(i => mapped[i].support), targets = tri.map(i => mapped[i].target);
          constrain(supports[0].clone().add(supports[1]).add(supports[2]).multiplyScalar(1 / 3), targets[0].clone().add(targets[1]).add(targets[2]).multiplyScalar(1 / 3));
          for (let k = 0; k < 3; k++) constrain(supports[k].clone().add(supports[(k + 1) % 3]).multiplyScalar(.5), targets[k].clone().add(targets[(k + 1) % 3]).multiplyScalar(.5));
        }
      }
      if (panel.detached && fraction < 1) {
        // Rare collision fallback: measure the actual live triangles, then
        // translate the entire plate outward. Shape and sidewalls stay fixed.
        for (let attempt = 0; attempt < 8; attempt++) {
          let minimum = Infinity;
          for (const vertex of mapped) minimum = Math.min(minimum, collisions.signedDistance(vertex.target));
          for (const tri of panel.triangles) minimum = Math.min(minimum, collisions.signedDistance(mapped[tri[0]].target.clone().add(mapped[tri[1]].target).add(mapped[tri[2]].target).multiplyScalar(1 / 3)));
          if (minimum >= .003) break;
          const correction = Math.max(.004, .004 - minimum) / .35;
          for (const vertex of mapped) vertex.target.addScaledVector(panel.outward, correction);
        }
        fraction = 1;
      }
      for (const vertex of mapped) { vertex.rendered ||= vec(); vertex.renderedNormal ||= vec(); vertex.rendered.copy(vertex.support).lerp(vertex.target, fraction); vertex.renderedNormal.copy(vertex.n).lerp(vertex.targetNormal, fraction).normalize(); }
      for (let r = panel.start; r < panel.end; r++) {
        const record = records[r], vertex = mapped[record.vertex]; normal.copy(vertex.renderedNormal); base.copy(vertex.rendered).addScaledVector(normal, record.layer * config.thickness);
        output[r * 3] = base.x; output[r * 3 + 1] = base.y; output[r * 3 + 2] = base.z;
        if (record.edge) {
          const [a, b] = record.edge; normal.copy(mapped[b].rendered).sub(mapped[a].rendered).cross(mapped[a].renderedNormal.clone().add(mapped[b].renderedNormal).normalize()).normalize();
        } else if (record.layer === 0) normal.negate();
        outputNormals[r * 3] = normal.x; outputNormals[r * 3 + 1] = normal.y; outputNormals[r * 3 + 2] = normal.z;
      }
    }
    shell.attributes.position.needsUpdate = true; shell.attributes.normal.needsUpdate = true; dirty = false;
  }
  function step(dt, time = clock()) {
    if (disposed) return { changed: false, needsFrame: false }; now = time;
    if (active && now - since > config.dwell && now - lastDrop >= config.fragmentInterval && totalDetached < config.maxFragments) {
      const burst = totalDetached === 0;
      const batch = localPanels(.48).slice(0, burst ? 3 : 1);
      for (let b = 0; b < batch.length; b++) {
        const panel = batch[b];
        if (totalDetached === config.maxFragments) break;
        panel.cracked = panel.detached = true; panel.born = now; panel.burst = burst; totalDetached++; lastDrop = now; dirty = true;
        panel.outward.set(0, 0, 0); for (const vertex of panel.vertices) panel.outward.add(map(vertex, normals, vec())); panel.outward.normalize();
        panel.burstTangent = gravity.clone().cross(panel.outward).normalize().multiplyScalar(b - 1);
        if (b === 1) panel.burstTangent.copy(gravity).negate().addScaledVector(panel.outward, gravity.dot(panel.outward)).normalize().multiplyScalar(.65);
      }
    }
    let living = false;
    for (const panel of panels) {
      if (active && panel.cracked && !panel.detached && panel.center.distanceTo(contact) < .4) { const lift = Math.min(.022, Math.max(0, now - since - .28) * .036); if (lift > panel.lift) { panel.lift = lift; dirty = true; } }
      if (!panel.detached || panel.dead) continue;
      dirty = living = true; const age = Math.max(0, now - panel.born);
      if (age >= config.lifetime) panel.dead = true;
      else {
        panel.offset.copy(panel.outward).multiplyScalar(.018 + (panel.burst ? (reducedMotion ? .04 : .18) * (1 - Math.exp(-age / .07)) : .02 * (1 - Math.exp(-age / .12))) + age * .16).addScaledVector(gravity, (reducedMotion ? .08 : .34) * age * age);
        if (panel.burst) panel.offset.addScaledVector(panel.burstTangent, (reducedMotion ? .03 : .14) * (1 - Math.exp(-age / .07)));
      }
    }
    const changed = dirty; if (changed) sync(); return { changed, needsFrame: active || living };
  }
  function reset() { end(); totalDetached = 0; for (const p of panels) { p.cracked = p.detached = p.dead = false; p.lift = 0; p.frozen = null; p.offset.set(0, 0, 0); } dirty = true; sync(); }
  function getState() { return { active, cracked: panels.filter(p => p.cracked).length, detached: totalDetached, living: panels.filter(p => p.detached && !p.dead).length, expired: panels.filter(p => p.dead).length, firstBurst: panels.filter(p => p.detached && p.burst).length, burstDuration: .14, burstInitialOutwardSpeed: reducedMotion ? .57 : 2.57, maxOutwardOffset: Math.max(0, ...panels.filter(p => p.detached && !p.dead).map(p => p.offset.dot(p.outward))), dwell: active ? Math.max(0, now - since) : 0, disposed, topology: 'clipped-surface-voronoi', panels: panels.length, visibleCrackRadius: .4 }; }
  function getMetrics({ exhaustive = false } = {}) {
    let minGap = Infinity, minSigned = Infinity, maxThicknessError = 0, attachedSamples = 0, attachedSurfaceSamples = 0, attachedViolations = 0, detachedSamples = 0, detachedInteriorSamples = 0, detachedMin = Infinity, detachedViolations = 0, wallSamples = 0;
    const normal = vec(), sourcePoint = vec();
    const sample = (position, detached, interior = false) => {
      const distance = collisions.signedDistance(position);
      if (detached) { detachedMin = Math.min(detachedMin, distance); if (interior) detachedInteriorSamples++; else detachedSamples++; if (distance < -.00001) detachedViolations++; }
      else { minSigned = Math.min(minSigned, distance); attachedSurfaceSamples++; if (distance < -.00001) attachedViolations++; }
    };
    for (const panel of panels) if (!panel.dead) {
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
    return { thickness: config.thickness, gap: config.gap, tolerance: .00001, attachedMinGap: minGap, attachedMinSignedDistance: minSigned, maxThicknessError, attachedSamples, attachedSurfaceSamples, attachedViolations, detachedSweepSamples: sweepSamples, detachedMinSignedDistance: Number.isFinite(detachedMin) ? detachedMin : null, detachedSamples, detachedInteriorSamples, detachedViolations, wallSamples, drawCalls: 1, shellVertices: records.length, shellTriangles: indices.length / 3, patches: panels.length, method: 'Voronoi-clipped original triangles, barycentric live-core support, frozen rigid detached curved templates, dynamic BVH sweeps, signed vertex/face/edge/wall checks' };
  }
  function dispose() { if (disposed) return; end(); disposed = true; shell.dispose(); material.dispose(); group.removeFromParent(); }
  function getSurfaceSnapshot() {
    const supports = new Float32Array(output.length), damage = new Uint8Array(records.length), referenceNormal = new Float32Array(output.length), layers = new Int8Array(records.length), panelIds = new Uint16Array(records.length), detached = new Uint8Array(records.length);
    const support = vec(), normal = vec();
    for (let r = 0; r < records.length; r++) {
      const record = records[r], vertex = record.panel.vertices[record.vertex];
      map(vertex, rest, support); map(vertex, referenceNormals, normal).normalize();
      supports.set(support.toArray(), r * 3); referenceNormal.set(normal.toArray(), r * 3); damage[r] = +record.panel.cracked; layers[r] = record.edge ? -1 : record.layer; panelIds[r] = record.panel.id; detached[r] = +(record.panel.detached && !record.panel.dead);
    }
    return { positions: output.slice(), normals: outputNormals.slice(), colors: colors.slice(), restSupportPositions: supports, restSupportNormals: referenceNormal, damage, layers, panelIds, detached };
  }
  sync();
  return { group, begin, move, end, release: end, cancel: end, sync, step, reset, dispose, getState, getMetrics, getSurfaceSnapshot, setGravity(value) { gravity.copy(point(value)).normalize(); }, setReducedMotion(value) { reducedMotion = !!value; } };
}
