// Visual memory-foam approximation. Contact is integrated in seconds at each
// location; there is no stroke-wide pressure, plastic base, or retained trail.
export const slowReboundParameters = Object.freeze({
  radius: .60,
  maximumDepth: .46,
  radialLimit: .50,
  pressSpeed: .45, // model units/second; uniform inward travel while yielding
  dragSpeed: 1.1,
  dragThreshold: .04,
  dragDepth: .20,
  dragGraceSeconds: .12,
  pressOnsetSeconds: .12,
  initialResponse: 1,
  contactRampSeconds: .10,
  contactMemoryDecay: 4,
  recoveryRate: .80,
  reducedRecoveryRate: 5,
  convergence: .00001,
  pathSpacing: .035,
  maximumContactStep: .10,
});

export function createSlowReboundDeformation(positions, normals, { reducedMotion = false, surfaceGeometry, getPressDirection, constrainPress, getPressRadius } = {}) {
  const p = slowReboundParameters;
  const rest = positions.slice(), count = positions.length / 3;
  const offsets = new Float32Array(count), restoreOffsets = new Float32Array(count);
  const contactTime = new Float32Array(count);
  const directions = new Float32Array(rest.length), limits = new Float32Array(count);
  // Optional spatial adapter: pressure travels along the input ray, never toward
  // a non-spherical model's center. Stored vectors keep old dents stable on rotation.
  const contactVectors = getPressDirection ? new Float32Array(rest.length) : null;
  const previousVectors = contactVectors ? contactVectors.slice() : null;
  const constrainContact = contactVectors ? (surfaceGeometry?.createContactSafety() ?? constrainPress) : null;
  let pressDirection = [0, 0, 1];
  const contactRadius = getPressRadius ?? (surfaceGeometry?.contactRadius ? (i, direction) => surfaceGeometry.contactRadius(i, direction) : null);
  const rayLimits = contactVectors && contactRadius ? new Float32Array(count).fill(-1) : null;
  function captureDirection() {
    if (!contactVectors) return;
    const value = getPressDirection(), length = Math.hypot(...value);
    if (value.length !== 3 || !Number.isFinite(length) || length < 1e-6) throw new RangeError('Invalid press direction');
    const normalized = value.map(n => n / length);
    if (normalized.some((n, k) => Math.abs(n - pressDirection[k]) > 1e-7)) rayLimits?.fill(-1);
    pressDirection = normalized;
  }
  const constrainOffsets = contactVectors ? null : surfaceGeometry?.constrainOffsets;
  const renderedOffsets = constrainOffsets ? new Float32Array(count) : null;
  const surfaceInfluences = surfaceGeometry ? new Float64Array(count) : null;
  let cachedSurfacePoint, cachedSurfaceNeighborhood;
  function surfaceNeighborhood(point) {
    if (!cachedSurfacePoint || point.some((value, k) => value !== cachedSurfacePoint[k])) {
      cachedSurfacePoint = [...point]; cachedSurfaceNeighborhood = surfaceGeometry.neighborhood(point, p.radius);
    }
    return cachedSurfaceNeighborhood;
  }
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rest.length; i++) {
    const k = i % 3; low[k] = Math.min(low[k], rest[i]); high[k] = Math.max(high[k], rest[i]);
  }
  const origin = low.map((v, k) => (v + high[k]) / 2);
  const axes = low.map((v, k) => Math.max(.001, (high[k] - v) / 2));
  for (let i = 0; i < count; i++) {
    const j = i * 3, radius = Math.hypot(...origin.map((v, k) => rest[j + k] - v));
    limits[i] = Math.min(p.maximumDepth, (surfaceGeometry ? surfaceGeometry.radii[i] : radius) * p.radialLimit);
    for (let k = 0; k < 3; k++) directions[j + k] = surfaceGeometry ? surfaceGeometry.directions[j + k] : (rest[j + k] - origin[k]) / Math.max(.001, radius);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let active = false, restoring = false, dirty = false, held = 0, strokeTravel = 0, lastMovement = -Infinity;
  let center = [0, 0, 1], pending = [];
  function endContact() { active = false; held = 0; strokeTravel = 0; lastMovement = -Infinity; pending = []; contactTime.fill(0); }
  function interruptRestore() { restoring = false; }
  function writePositions() {
    let accepted = 1;
    if (contactVectors) {
      // The accepted surface has a checked straight route to rest. Release and
      // explicit restore only shorten that route; they need no new face solve.
      if (active && !restoring && constrainContact) accepted = constrainContact(previousVectors, contactVectors);
      for (let i = 0; i < count; i++) offsets[i] = Math.hypot(contactVectors[i * 3], contactVectors[i * 3 + 1], contactVectors[i * 3 + 2]);
      previousVectors.set(contactVectors);
    }
    if (constrainOffsets) { accepted = constrainOffsets(renderedOffsets, offsets); renderedOffsets.set(offsets); }
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      for (let k = 0; k < 3; k++) positions[j + k] = offsets[i] === 0 ? rest[j + k] : rest[j + k] - (contactVectors ? contactVectors[j + k] : directions[j + k] * offsets[i]);
    }
    return accepted;
  }
  // Interpolate on the normalized rest ellipsoid, never through its interior.
  function segment(from, to) {
    if (surfaceGeometry) {
      const points = surfaceGeometry.path(from, to, p.pathSpacing);
      let distance = 0, previous = from;
      for (const point of points) { distance += Math.hypot(...point.map((v, k) => v - previous[k])); previous = point; }
      return { distance, points };
    }
    const a = from.map((v, k) => (v - origin[k]) / axes[k]);
    const b = to.map((v, k) => (v - origin[k]) / axes[k]);
    const ra = Math.hypot(...a), rb = Math.hypot(...b);
    if (ra < .00001 || rb < .00001) return { distance: 0, points: [to] };
    const u = a.map(v => v / ra), v = b.map(n => n / rb);
    const cosine = clamp(u.reduce((sum, n, k) => sum + n * v[k], 0), -1, 1);
    const angle = Math.acos(cosine);
    const distance = Math.max(Math.hypot(...from.map((n, k) => n - to[k])), angle * Math.max(...axes));
    const tangent = v.map((n, k) => n - u[k] * cosine);
    let length = Math.hypot(...tangent);
    if (length < .00001 && angle > 1) {
      const axis = Math.abs(u[0]) < .8 ? [1, 0, 0] : [0, 1, 0];
      const dot = axis.reduce((sum, n, k) => sum + n * u[k], 0);
      for (let k = 0; k < 3; k++) tangent[k] = axis[k] - dot * u[k];
      length = Math.hypot(...tangent);
    }
    const steps = Math.max(1, Math.ceil(distance / p.pathSpacing)), points = [];
    for (let s = 0; s < steps; s++) {
      const t = (s + .5) / steps, radius = ra + (rb - ra) * t;
      points.push(u.map((n, k) => origin[k] + axes[k] * radius * (angle < .00001 ? n : n * Math.cos(angle * t) + tangent[k] / length * Math.sin(angle * t))));
    }
    return { distance, points };
  }
  return {
    begin(point) { interruptRestore(); endContact(); active = true; center = [...point]; captureDirection(); },
    move(point) { if (active) { pending.push([...point]); captureDirection(); } },
    release: endContact,
    cancel: endContact,
    reset() {
      endContact(); restoring = false; offsets.fill(0); restoreOffsets.fill(0);
      positions.set(rest); renderedOffsets?.fill(0); contactVectors?.fill(0); previousVectors?.fill(0); dirty = true;
    },
    beginRestore() { endContact(); restoreOffsets.set(offsets); restoring = true; },
    applyRestore(progress) {
      if (!restoring) return;
      const remaining = (1 - clamp(progress, 0, 1)) ** 3;
      for (let i = 0; i < count; i++) {
        const next = restoreOffsets[i] * remaining;
        if (contactVectors) for (let k = 0; k < 3; k++) contactVectors[i * 3 + k] *= offsets[i] ? next / offsets[i] : 0;
        offsets[i] = next;
      }
      dirty = true;
      if (progress >= 1) restoring = false;
    },
    interruptRestore,
    setReducedMotion(value) { reducedMotion = Boolean(value); },
    getState() {
      return { active, restoring, held, depth: Math.max(...offsets), retainedDepth: 0, center: [...center] };
    },
    step(elapsed) {
      const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
      const dt = active ? Math.min(seconds, p.maximumContactStep) : seconds;
      let changed = dirty, atRest = true, moving = false, motionTransition = false;
      if (!restoring) {
        const contacts = [];
        const previousHeld = held;
        if (active) {
          held += dt;
          let total = 0;
          for (const point of pending) {
            const path = segment(center, point);
            if (path.distance > .000001) { contacts.push(path); total += path.distance; }
            center = point;
          }
          pending = [];
          strokeTravel += total;
          if (total > .000001) lastMovement = held;
          if (total === 0) contacts.push({ points: [center], distance: 1 });
          else for (const path of contacts) path.distance /= total;
        }
        // A short, continuous onset makes the start of a press legible. Integrate
        // the speed ramp exactly, then keep a uniform speed without an ease-out
        // tail. New path points still receive only this frame's local contact.
        const pressIntegral = t => t < p.pressOnsetSeconds
          ? t * t / (2 * p.pressOnsetSeconds) : t - p.pressOnsetSeconds / 2;
        const pressSeconds = active ? pressIntegral(held) - pressIntegral(previousHeld) : 0;
        // Slow stationary pressing should not erase the legibility of dragging.
        // Travel is measured in model units, never in number of input events.
        const dragging = strokeTravel >= p.dragThreshold && held - lastMovement <= p.dragGraceSeconds;
        motionTransition = active && dragging;
        const inwardSpeed = dragging ? p.dragSpeed : p.pressSpeed;
        if (surfaceInfluences) {
          surfaceInfluences.fill(0);
          for (const path of contacts) for (const point of path.points) {
            for (const [i, distance] of surfaceNeighborhood(point)) {
              const q2 = distance ** 2 / p.radius ** 2;
              if (q2 < 1) surfaceInfluences[i] += (1 - q2) ** 3 * path.distance / path.points.length;
            }
          }
        }
        for (let i = 0; i < count; i++) {
          const j = i * 3;
          let influence = 0;
          if (surfaceInfluences) influence = surfaceInfluences[i];
          else for (const path of contacts) for (const point of path.points) {
            const q2 = ((rest[j] - point[0]) ** 2 + (rest[j + 1] - point[1]) ** 2 + (rest[j + 2] - point[2]) ** 2) / p.radius ** 2;
            if (q2 < 1) influence += (1 - q2) ** 3 * path.distance / path.points.length;
          }
          let limit = limits[i];
          if (rayLimits && influence > 0) {
            if (rayLimits[i] < 0) rayLimits[i] = Math.min(p.maximumDepth, contactRadius(i, pressDirection) * p.radialLimit);
            limit = Math.min(limit, rayLimits[i]);
          }
          const target = Math.min(limit, dragging ? p.dragDepth : p.maximumDepth) * Math.min(1, influence), before = offsets[i];
          // Each vertex yields gradually after local contact. A long hold at A
          // cannot give a freshly visited B the same fully yielded response.
          contactTime[i] = Math.min(p.contactRampSeconds, contactTime[i] * Math.exp(-p.contactMemoryDecay * dt * (1 - influence)) + dt * influence);
          const yielding = p.initialResponse + (1 - p.initialResponse) * contactTime[i] / p.contactRampSeconds;
          const rate = reducedMotion ? p.reducedRecoveryRate : p.recoveryRate;
          const next = active && target > before
            ? Math.min(target, before + inwardSpeed * influence * yielding * pressSeconds)
            : before + (target - before) * -Math.expm1(-rate * dt);
          // Snap only a subpixel remainder to the exact original mesh. Active
          // near-equilibrium values also settle, so a held press can stop frames.
          offsets[i] = Math.abs(next - target) <= p.convergence ? target : next;
          if (contactVectors && offsets[i] !== before) {
            for (let k = 0; k < 3; k++) {
              if (offsets[i] > before) contactVectors[j + k] += pressDirection[k] * (offsets[i] - before);
              else contactVectors[j + k] *= before ? offsets[i] / before : 0;
            }
          }
          changed ||= offsets[i] !== before;
          moving ||= offsets[i] !== target;
        }
      }
      for (let i = 0; i < count; i++) atRest &&= offsets[i] === 0;
      if (changed) {
        const accepted = writePositions();
        if (constrainOffsets || contactVectors) { moving &&= accepted > 1e-5; atRest = offsets.every(value => value === 0); }
        dirty = false;
      }
      return { changed, atRest, needsFrame: moving || restoring || motionTransition };
    },
  };
}
