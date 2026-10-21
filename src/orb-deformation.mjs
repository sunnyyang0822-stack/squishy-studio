// Bounded plastic dents live in model space. Each stroke keeps the maximum
// influence along its sampled path, so holding or revisiting cannot pile up clay.
export function createOrbDeformation(positions, normals, { reducedMotion = false } = {}) {
  const rest = positions.slice();
  const count = positions.length / 3;
  const offsets = new Float32Array(count), retained = new Float32Array(count), envelope = new Float32Array(count);
  const center = [0, 0, 1], targetCenter = [0, 0, 1];
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rest.length; i++) { const k = i % 3; low[k] = Math.min(low[k], rest[i]); high[k] = Math.max(high[k], rest[i]); }
  const origin = low.map((value, k) => (value + high[k]) / 2);
  const axes = low.map((value, k) => Math.max(.001, (high[k] - value) / 2));
  const directions = new Float32Array(rest.length), limits = new Float32Array(count);
  const restoreOffsets = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const index = i * 3;
    const radial = origin.map((value, k) => rest[index + k] - value);
    const radius = Math.hypot(...radial);
    limits[i] = radius * .92;
    for (let k = 0; k < 3; k++) directions[index + k] = radial[k] / Math.max(.001, radius);
  }
  let active = false, held = 0, drag = 0, dirty = false, restoring = false;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const copyPoint = (out, point) => { for (let i = 0; i < 3; i++) out[i] = point[i]; };
  function stamp(point) {
    for (let i = 0; i < count; i++) {
      const index = i * 3;
      const q2 = ((rest[index] - point[0]) ** 2 + (rest[index + 1] - point[1]) ** 2 + (rest[index + 2] - point[2]) ** 2) / (.66 ** 2);
      if (q2 < 1) envelope[i] = Math.max(envelope[i], (1 - q2) ** 2);
    }
  }
  function samplePath(from, to) {
    // Follow the rounded rest surface rather than cutting a chord through its
    // interior. Sparse events still leave a connected path on the visible skin.
    const a = from.map((v, k) => (v - origin[k]) / axes[k]);
    const b = to.map((v, k) => (v - origin[k]) / axes[k]);
    const ra = Math.hypot(...a), rb = Math.hypot(...b);
    if (ra < .0001 || rb < .0001) { stamp(to); return; }
    const u = a.map(v => v / ra), v = b.map(n => n / rb);
    const angle = Math.acos(clamp(u.reduce((sum, n, k) => sum + n * v[k], 0), -1, 1));
    const distance = Math.max(Math.hypot(...to.map((n, k) => n - from[k])), angle * Math.max(...axes) * Math.max(ra, rb));
    const steps = Math.max(1, Math.ceil(distance / .04));
    const tangent = v.map((n, k) => n - u[k] * Math.cos(angle));
    let tangentLength = Math.hypot(...tangent);
    if (tangentLength < .00001 && angle > 1) {
      const axis = Math.abs(u[0]) < .8 ? [1, 0, 0] : [0, 1, 0];
      const dot = axis.reduce((sum, n, k) => sum + n * u[k], 0);
      for (let k = 0; k < 3; k++) tangent[k] = axis[k] - dot * u[k];
      tangentLength = Math.hypot(...tangent);
    }
    for (let sample = 1; sample <= steps; sample++) {
      const t = sample / steps, radius = ra + (rb - ra) * t;
      const point = u.map((n, k) => origin[k] + axes[k] * radius * (angle < .00001 ? n : n * Math.cos(angle * t) + tangent[k] / tangentLength * Math.sin(angle * t)));
      stamp(sample === steps ? to : point);
    }
  }
  function cancel() {
    active = false; held = drag = 0; envelope.fill(0);
    if (restoring) return;
    offsets.set(retained); dirty = true;
    copyPoint(center, targetCenter);
  }
  function interruptRestore() {
    if (!restoring) return;
    retained.set(offsets); restoring = false;
  }
  return {
    begin(point) {
      interruptRestore();
      active = true; held = drag = 0; envelope.fill(0);
      copyPoint(center, point); copyPoint(targetCenter, point); stamp(point);
    },
    move(point, distance) {
      if (!active) return;
      samplePath(targetCenter, point); copyPoint(targetCenter, point); drag = Math.max(drag, clamp(distance, 0, 1));
    },
    release() {
      if (!active) return;
      active = false;
      // Only 15% of the completed stroke rebounds, including at deep pressures.
      for (let i = 0; i < count; i++) retained[i] += (offsets[i] - retained[i]) * .85;
      envelope.fill(0);
    },
    cancel,
    reset() { restoring = false; retained.fill(0); cancel(); positions.set(rest); },
    beginRestore() {
      active = false; held = drag = 0; envelope.fill(0);
      restoreOffsets.set(offsets); retained.fill(0); restoring = true;
    },
    applyRestore(progress) {
      if (!restoring) return;
      const remaining = (1 - clamp(progress, 0, 1)) ** 3;
      for (let i = 0; i < count; i++) offsets[i] = restoreOffsets[i] * remaining;
      dirty = true;
      if (progress >= 1) restoring = false;
    },
    interruptRestore,
    setReducedMotion(value) { reducedMotion = value; },
    getState() { return { active, restoring, held, drag, depth: Math.max(...offsets), retainedDepth: Math.max(...retained), center: [...center] }; },
    step(elapsed) {
      const dt = clamp(elapsed, 0, .064);
      if (active) held += Math.max(0, elapsed);
      // A light touch is shallow. Deliberate holding gradually yields further,
      // rather than dropping immediately into a nearly full-strength dent.
      const strength = .025 + .45 * Math.min(Math.max(held - .12, 0) / 2.4, 1) + .04 * Math.min(drag / .5, 1);
      let centerDelta = 0;
      for (let k = 0; k < 3; k++) {
        const delta = targetCenter[k] - center[k]; centerDelta += delta * delta;
        center[k] += delta * (1 - Math.exp(-24 * dt));
      }
      // Monotone first-order response has no overshoot, recoil, or outward lip.
      const blend = 1 - Math.exp(-(reducedMotion ? 16 : active ? 7 : 10) * dt);
      let moving = false, changed = dirty, atRest = true;
      for (let i = 0; i < count; i++) {
        // Compression stiffens continuously as material approaches its center.
        // Radial motion preserves a positive radius, avoiding an inverted skin;
        // there is no shared 0.30 stop or rigid inner sphere.
        const target = restoring ? offsets[i] : active ? retained[i] + (limits[i] - retained[i]) * (1 - Math.exp(-strength * envelope[i] / limits[i])) : retained[i];
        const before = offsets[i];
        const next = before + (target - before) * blend;
        if (Math.abs(target - next) <= .00002) offsets[i] = target;
        else { offsets[i] = next; moving = true; }
        changed ||= offsets[i] !== before;
        atRest &&= offsets[i] === 0;
      }
      if (changed) {
        for (let i = 0; i < count; i++) {
          const index = i * 3, offset = offsets[i];
          positions[index] = rest[index] - directions[index] * offset;
          positions[index + 1] = rest[index + 1] - directions[index + 1] * offset;
          positions[index + 2] = rest[index + 2] - directions[index + 2] * offset;
        }
        dirty = false;
      }
      return { changed, atRest, needsFrame: moving || restoring || (active && (held < 2.52 || centerDelta > .000001)) };
    },
  };
}
