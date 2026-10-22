// Visual memory-foam approximation. Contact is integrated in seconds at each
// location; there is no stroke-wide pressure, plastic base, or retained trail.
export const slowReboundParameters = Object.freeze({
  radius: .60,
  maximumDepth: .34,
  radialLimit: .40,
  pressRate: .45,
  initialResponse: .10,
  contactRampSeconds: .75,
  contactMemoryDecay: 4,
  recoveryRate: .80,
  reducedRecoveryRate: 5,
  convergence: .00001,
  pathSpacing: .035,
  maximumContactStep: .10,
});

export function createSlowReboundDeformation(positions, normals, { reducedMotion = false } = {}) {
  const p = slowReboundParameters;
  const rest = positions.slice(), count = positions.length / 3;
  const offsets = new Float32Array(count), restoreOffsets = new Float32Array(count);
  const contactTime = new Float32Array(count);
  const directions = new Float32Array(rest.length), limits = new Float32Array(count);
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rest.length; i++) {
    const k = i % 3; low[k] = Math.min(low[k], rest[i]); high[k] = Math.max(high[k], rest[i]);
  }
  const origin = low.map((v, k) => (v + high[k]) / 2);
  const axes = low.map((v, k) => Math.max(.001, (high[k] - v) / 2));
  for (let i = 0; i < count; i++) {
    const j = i * 3, radius = Math.hypot(...origin.map((v, k) => rest[j + k] - v));
    limits[i] = Math.min(p.maximumDepth, radius * p.radialLimit);
    for (let k = 0; k < 3; k++) directions[j + k] = (rest[j + k] - origin[k]) / Math.max(.001, radius);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let active = false, restoring = false, dirty = false, held = 0;
  let center = [0, 0, 1], pending = [];
  function endContact() { active = false; held = 0; pending = []; contactTime.fill(0); }
  function interruptRestore() { restoring = false; }
  function writePositions() {
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      for (let k = 0; k < 3; k++) positions[j + k] = offsets[i] === 0 ? rest[j + k] : rest[j + k] - directions[j + k] * offsets[i];
    }
  }
  // Interpolate on the normalized rest ellipsoid, never through its interior.
  function segment(from, to) {
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
    begin(point) { interruptRestore(); endContact(); active = true; center = [...point]; },
    move(point) { if (active) pending.push([...point]); },
    release: endContact,
    cancel: endContact,
    reset() {
      endContact(); restoring = false; offsets.fill(0); restoreOffsets.fill(0);
      positions.set(rest); dirty = true;
    },
    beginRestore() { endContact(); restoreOffsets.set(offsets); restoring = true; },
    applyRestore(progress) {
      if (!restoring) return;
      const remaining = (1 - clamp(progress, 0, 1)) ** 3;
      for (let i = 0; i < count; i++) offsets[i] = restoreOffsets[i] * remaining;
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
      let changed = dirty, atRest = true, moving = false;
      if (!restoring) {
        const contacts = [];
        if (active) {
          held += dt;
          let total = 0;
          for (const point of pending) {
            const path = segment(center, point);
            if (path.distance > .000001) { contacts.push(path); total += path.distance; }
            center = point;
          }
          pending = [];
          if (total === 0) contacts.push({ points: [center], distance: 1 });
          else for (const path of contacts) path.distance /= total;
        }
        for (let i = 0; i < count; i++) {
          const j = i * 3;
          let influence = 0;
          for (const path of contacts) for (const point of path.points) {
            const q2 = ((rest[j] - point[0]) ** 2 + (rest[j + 1] - point[1]) ** 2 + (rest[j + 2] - point[2]) ** 2) / p.radius ** 2;
            if (q2 < 1) influence += (1 - q2) ** 3 * path.distance / path.points.length;
          }
          const target = limits[i] * Math.min(1, influence), before = offsets[i];
          // Each vertex yields gradually after local contact. A long hold at A
          // cannot give a freshly visited B the same fully yielded response.
          contactTime[i] = Math.min(p.contactRampSeconds, contactTime[i] * Math.exp(-p.contactMemoryDecay * dt * (1 - influence)) + dt * influence);
          const yielding = p.initialResponse + (1 - p.initialResponse) * contactTime[i] / p.contactRampSeconds;
          const rate = active && target > before ? p.pressRate * yielding : reducedMotion ? p.reducedRecoveryRate : p.recoveryRate;
          const blend = -Math.expm1(-rate * dt);
          const next = before + (target - before) * blend;
          // Snap only a subpixel remainder to the exact original mesh. Active
          // near-equilibrium values also settle, so a held press can stop frames.
          offsets[i] = Math.abs(next - target) <= p.convergence ? target : next;
          changed ||= offsets[i] !== before;
          moving ||= offsets[i] !== target;
        }
      }
      for (let i = 0; i < count; i++) atRest &&= offsets[i] === 0;
      if (changed) { writePositions(); dirty = false; }
      return { changed, atRest, needsFrame: moving || restoring };
    },
  };
}
