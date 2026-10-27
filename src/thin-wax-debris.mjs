import * as THREE from 'three';

export const waxFallthroughPolicy = Object.freeze({ discardBelowY: -4, maxLifetime: 8 });

// World-space rigid curved chips and a bounded, conservative support grid.
// The grid is collision data only; the rendered pile keeps the real wax meshes.
export function createWaxDebris({ thickness, floorY = -1.35, radius = 1.35, reducedMotion = false, collectionEnabled = true, fallLifetime = waxFallthroughPolicy.maxLifetime } = {}) {
  let highestSupport = floorY;
  const bodies = new Map(), heights = new Map(), cell = .045;
  const seen = new Set(), expired = [];
  const up = new THREE.Vector3(0, 1, 0), identity = new THREE.Quaternion();
  const hash = id => { const v = Math.sin((id + 1) * 127.1) * 43758.5453; return v - Math.floor(v); };
  const key = (x, z) => `${x}:${z}`;
  const height = (x, z) => heights.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? floorY;
  function points(body, out = []) {
    for (let i = 0; i < body.vertices.length; i++) (out[i] ||= new THREE.Vector3()).copy(body.vertices[i]).applyQuaternion(body.rotation).add(body.position);
    return out;
  }
  function physicalBounds(body, vertices) {
    let bottom = Infinity, top = -Infinity;
    const normal = new THREE.Vector3();
    for (let i = 0; i < vertices.length; i++) {
      const outerY = vertices[i].y + normal.copy(body.normals[i]).applyQuaternion(body.rotation).y * thickness;
      bottom = Math.min(bottom, vertices[i].y, outerY); top = Math.max(top, vertices[i].y, outerY);
    }
    return { bottom, top };
  }
  function supportLift(body, vertices) {
    let shift = floorY - physicalBounds(body, vertices).bottom;
    const normal = new THREE.Vector3(), point = new THREE.Vector3();
    const sample = p => { shift = Math.max(shift, height(p.x, p.z) - p.y); };
    for (let i = 0; i < vertices.length; i++) {
      sample(vertices[i]); sample(point.copy(vertices[i]).addScaledVector(normal.copy(body.normals[i]).applyQuaternion(body.rotation), thickness));
    }
    for (const triangle of body.triangles) {
      sample(point.copy(vertices[triangle[0]]).add(vertices[triangle[1]]).add(vertices[triangle[2]]).multiplyScalar(1 / 3));
      for (let k = 0; k < 3; k++) sample(point.copy(vertices[triangle[k]]).add(vertices[triangle[(k + 1) % 3]]).multiplyScalar(.5));
    }
    return shift;
  }
  function deposit(body) {
    const vertices = points(body, body.world);
    // Original source triangles are small. Conservative cell coverage keeps
    // curved edges from interleaving without a flat per-shard platform.
    for (const triangle of body.triangles) {
      const p = triangle.map(i => vertices[i]), top = Math.max(...triangle.map(i => vertices[i].y + Math.max(0, body.normals[i].clone().applyQuaternion(body.rotation).y * thickness))) + .0015;
      const lowX = Math.floor(Math.min(...p.map(v => v.x)) / cell), highX = Math.floor(Math.max(...p.map(v => v.x)) / cell);
      const lowZ = Math.floor(Math.min(...p.map(v => v.z)) / cell), highZ = Math.floor(Math.max(...p.map(v => v.z)) / cell);
      for (let x = lowX; x <= highX; x++) for (let z = lowZ; z <= highZ; z++) {
        const k = key(x, z); highestSupport = Math.max(highestSupport, top); heights.set(k, Math.max(heights.get(k) ?? floorY, top));
      }
    }
  }
  function add(id, vertices, normals, triangles, time) {
    if (bodies.has(id)) return bodies.get(id);
    if (seen.has(id)) return undefined;
    seen.add(id);
    const position = new THREE.Vector3(); for (const vertex of vertices) position.add(vertex); position.multiplyScalar(1 / vertices.length);
    const normal = new THREE.Vector3(); for (const n of normals) normal.add(n); normal.normalize();
    const random = hash(id), lean = new THREE.Vector3((random - .5) * .20, 1, (hash(id + 71) - .5) * .20).normalize();
    const landingRotation = new THREE.Quaternion().setFromUnitVectors(normal, lean);
    const yaw = new THREE.Quaternion().setFromAxisAngle(up, (random - .5) * .65); landingRotation.premultiply(yaw);
    const body = { id, born: time, position, vertices: vertices.map(v => v.clone().sub(position)), normals: normals.map(v => v.clone()), triangles,
      velocity: new THREE.Vector3((random - .5) * .06, -.42, (hash(id + 19) - .5) * .06), rotation: identity.clone(), landingRotation,
      settled: false, contactTime: null, world: [], supportY: floorY, slideTarget: null };
    bodies.set(id, body); return body;
  }
  function advance(dt, time) {
    let moving = false;
    const steps = Math.max(1, Math.ceil(Math.min(Math.max(dt, 0), 2) / (1 / 90))), h = Math.min(Math.max(dt, 0), 2) / steps;
    for (let iteration = 0; iteration < steps; iteration++) for (const body of bodies.values()) {
      if (body.settled) continue; moving = true;
      const simulationTime = time - h * (steps - iteration - 1);
      const effectiveStep = Math.min(h, Math.max(0, simulationTime - body.born));
      if (effectiveStep <= 0) continue;
      body.velocity.y -= 8.4 * effectiveStep;
      body.position.addScaledVector(body.velocity, effectiveStep);
      const age = Math.max(0, simulationTime - body.born);
      body.rotation.slerpQuaternions(identity, body.landingRotation, Math.min(1, age / (reducedMotion ? .12 : .38)));
      let vertices = points(body, body.world), bounds = physicalBounds(body, vertices), lowest = bounds.bottom;
      const top = bounds.top;
      if (!collectionEnabled) {
        if (top < waxFallthroughPolicy.discardBelowY || simulationTime - body.born >= fallLifetime) { bodies.delete(body.id); expired.push(body.id); }
        continue;
      }
      // Confine only after the whole chip clears the core. A turned toy cannot
      // drag the pile, and collection cannot pull a falling chip through it.
      if (top < -1.015) {
        const extent = Math.max(...vertices.map(v => Math.hypot(v.x - body.position.x, v.z - body.position.z)));
        body.planarExtent = extent;
        const limit = Math.max(.45, radius - extent - .035), radial = Math.hypot(body.position.x, body.position.z);
        if (radial > limit) { body.position.x *= limit / radial; body.position.z *= limit / radial; vertices = points(body, body.world); }
      }
      if (lowest > highestSupport + .002) continue;
      const lift = supportLift(body, vertices); body.supportY = lowest + lift;
      if (lift >= -.002) {
        // Every landing must fit the tray, including a curved chip touching a
        // tall existing pile before its top has cleared the core's base.
        const extent = Math.max(...vertices.map(v => Math.hypot(v.x - body.position.x, v.z - body.position.z)));
        body.planarExtent = extent;
        const limit = Math.max(.05, radius - extent - .035), radial = Math.hypot(body.position.x, body.position.z);
        if (radial > limit) {
          body.position.x *= limit / radial; body.position.z *= limit / radial;
          vertices = points(body, body.world); lowest = physicalBounds(body, vertices).bottom;
        }
        const landingLift = supportLift(body, vertices);
        body.position.y += landingLift + .002; body.velocity.y = 0;
        body.supportY = lowest + landingLift;
        body.contactTime ??= simulationTime;
        // A high spot sends a new chip a short distance to a lower nearby
        // support. This prevents a vertical tower at repeated contact points.
        if (!body.slideTarget && body.supportY > floorY + .06) {
          const origin = body.position.clone();
          let best = { x: origin.x, z: origin.z, score: body.position.y };
          for (const distance of [.22, .45, .68]) for (let i = 0; i < 12; i++) {
            const angle = i * Math.PI / 6 + hash(body.id), x = origin.x + Math.cos(angle) * distance, z = origin.z + Math.sin(angle) * distance;
            const extent = Math.max(...vertices.map(v => Math.hypot(v.x - origin.x, v.z - origin.z)));
            if (Math.hypot(x, z) > radius - extent - .035) continue;
            body.position.x = x; body.position.z = z;
            const score = body.position.y + supportLift(body, points(body, body.world));
            if (score < best.score - .015) best = { x, z, score };
          }
          body.position.copy(origin); body.slideTarget = best;
        }
        if (body.slideTarget) {
          const blend = Math.min(1, effectiveStep * 16); body.position.x += (body.slideTarget.x - body.position.x) * blend; body.position.z += (body.slideTarget.z - body.position.z) * blend;
        }
        body.velocity.x *= Math.exp(-effectiveStep * 18); body.velocity.z *= Math.exp(-effectiveStep * 18);
        const sliding = body.slideTarget && Math.hypot(body.position.x - body.slideTarget.x, body.position.z - body.slideTarget.z) > .012;
        if (!sliding && age >= (reducedMotion ? .12 : .38) && simulationTime - body.contactTime > (reducedMotion ? .06 : .20)) {
          vertices = points(body, body.world); const finalLift = supportLift(body, vertices);
          if (finalLift < -.008) { body.contactTime = null; continue; }
          body.position.y += finalLift + .002;
          body.velocity.set(0, 0, 0); body.settled = true; deposit(body);
        }
      }
    }
    return moving;
  }
  function state() {
    const all = [...bodies.values()], vertices = all.flatMap(body => points(body, body.world));
    const bottom = all.length ? Math.min(...all.map(body => physicalBounds(body, points(body, body.world)).bottom)) : null;
    return { floorY, radius, moving: all.filter(b => !b.settled).length, settled: all.filter(b => b.settled).length,
      minY: bottom,
      maxRadius: vertices.length ? Math.max(...vertices.map(v => Math.hypot(v.x, v.z))) : 0,
      pileTop: Math.max(floorY, ...[...heights.values()]), gridCells: heights.size };
  }
  function setCollectionEnabled(value) {
    value = !!value; if (value === collectionEnabled) return;
    collectionEnabled = value;
    heights.clear(); highestSupport = floorY;
    if (!value) for (const body of bodies.values()) {
      body.settled = false; body.contactTime = null; body.slideTarget = null;
      body.velocity.y = Math.min(body.velocity.y, -.42);
    }
  }
  return { add, advance, get: id => bodies.get(id), points, state, setCollectionEnabled, isCollectionEnabled: () => collectionEnabled, drainExpired() { return expired.splice(0); }, reset() { bodies.clear(); heights.clear(); seen.clear(); expired.length = 0; highestSupport = floorY; }, setReducedMotion(value) { reducedMotion = !!value; } };
}
