// Independent local plastic collapse: gradual contact, shallow swept segments, frozen unload.
export function createMarshmallowDeformation(positions, normals, { reducedMotion = false } = {}) {
  const rest = positions.slice();
  const count = positions.length / 3;
  const offsets = new Float32Array(count), retained = new Float32Array(count), envelope = new Float32Array(count);
  const contactTime = new Float32Array(count);
  let swept = false, pathAdvanced = false;
  const center = [0, 0, 1], targetCenter = [0, 0, 1], pressOrigin = [0, 0, 1];
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
    limits[i] = Math.min(.70, radius * .76);
    for (let k = 0; k < 3; k++) directions[index + k] = radial[k] / Math.max(.001, radius);
  }
  let active = false, held = 0, drag = 0, dirty = false, restoring = false;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const copyPoint = (out, point) => { for (let i = 0; i < 3; i++) out[i] = point[i]; };
  function stamp(point) {
    for (let i = 0; i < count; i++) {
      const index = i * 3;
      const q2 = ((rest[index] - point[0]) ** 2 + (rest[index + 1] - point[1]) ** 2 + (rest[index + 2] - point[2]) ** 2) / (.40 ** 2);
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

  function finish() { active = false; retained.set(offsets); envelope.fill(0); contactTime.fill(0); held = drag = 0; swept = false; pathAdvanced = false; }
  function interruptRestore() { if (restoring) { restoring = false; retained.set(offsets); } }
  return {
    begin(point) {
      interruptRestore(); retained.set(offsets); envelope.fill(0); active = true; held = drag = 0; swept = false; pathAdvanced = false; contactTime.fill(0);
      copyPoint(center, point); copyPoint(targetCenter, point); copyPoint(pressOrigin, point); stamp(point);
    },
    move(point, distance = 0) {
      if (!active) return;
      // Sweeping follows the pointer promptly, but its depth still follows
      // the same gradual pressure ramp. Zero-distance events cannot speed a press.
      swept ||= Math.hypot(...point.map((v, k) => v - pressOrigin[k])) > .02;
      pathAdvanced ||= Math.hypot(...point.map((v,k) => v-targetCenter[k])) > .002;
      samplePath(targetCenter, point); copyPoint(targetCenter, point); copyPoint(center, point); drag = distance;
    },
    release: finish,
    cancel: finish,
    reset() { restoring = false; finish(); offsets.fill(0); retained.fill(0); positions.set(rest); dirty = true; },
    beginRestore() { finish(); restoreOffsets.set(offsets); restoring = true; },
    applyRestore(progress) {
      if (!restoring) return;
      const remaining = (1 - clamp(progress, 0, 1)) ** 3;
      for (let i = 0; i < count; i++) offsets[i] = restoreOffsets[i] * remaining;
      dirty = true;
      if (progress >= 1) { restoring = false; retained.set(offsets); }
    },
    interruptRestore,
    setReducedMotion(value) { reducedMotion = value; },
    getState() { return { active, restoring, held, drag, depth: Math.max(...offsets), retainedDepth: Math.max(...retained), center: [...center] }; },
    step(elapsed) {
      // A delayed render must not consume a whole hold in one visible frame.
      // Slow devices progress over rendered frames instead of jumping deeper.
      const dt = Math.min(.04, Math.max(0, Number.isFinite(elapsed) ? elapsed : 0));
      if (active) held += dt;
      // A shallow touch yields before a deliberate hold. The .70 safety
      // boundary is approached over separate presses, never a single tap.
      // Pressure age belongs only to the current footprint, not the historical path.
      const blend = -Math.expm1(-8 * dt);
      let changed = dirty, moving = false, atRest = true;
      for (let i = 0; i < count; i++) {
        const index = i * 3;
        const q2 = ((rest[index] - targetCenter[0]) ** 2 +
          (rest[index + 1] - targetCenter[1]) ** 2 +
          (rest[index + 2] - targetCenter[2]) ** 2) / (.40 ** 2);
        const local = q2 < 1 ? (1 - q2) ** 2 : 0;
        if (active && dt > 0) contactTime[i] = local > 0 ? contactTime[i] + dt : 0;
        // A swept contact starts at the same pressure as its shallow trail.
        // Starting it below .06 would create a dead zone before holding can
        // exceed the visible trail depth.
        const localStrength = (swept && !pathAdvanced ? .06 : .03) + .58 * Math.min(contactTime[i] / 2, 1);
        // Pending swept segments get one shallow stamp. Once the contact leaves,
        // keep the exact reached depth; dwelling elsewhere cannot deepen them.
        const pressure = Math.max(localStrength * local, swept ? .06 * envelope[i] : 0);
        const target = Math.max(offsets[i], retained[i] + (limits[i] - retained[i]) *
          -Math.expm1(-pressure / Math.max(.001, limits[i])));
        if (active && dt > 0) {
          // Spatially sampled shallow sweeps must be visible even when input
          // arrives just before the frame; only this bounded shallow target gets
          // a minimum exposure. Continued local holding keeps its gradual ramp.
          const pathBlend = swept && envelope[i] > 0
            ? Math.max(blend, -Math.expm1(-240 * Math.max(dt, 1 / 60))) : blend;
          const next = offsets[i] + (target - offsets[i]) * pathBlend;
          const value = Math.abs(target - next) < .00001 ? target : next;
          changed ||= value !== offsets[i]; offsets[i] = value; moving ||= value !== target;
        }
        atRest &&= offsets[i] === 0; // Scene uses this to restore original normals only on an undeformed mesh.
      }
      if (active && dt > 0) { envelope.fill(0); pathAdvanced = false; }
      if (changed) {
        for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
          const index = i * 3 + k; positions[index] = offsets[i] === 0 ? rest[index] : rest[index] - directions[index] * offsets[i];
        }
        dirty = false;
      }
      return { changed, atRest, needsFrame: restoring || (active && (moving || held < 2 || contactTime.some(t => t > 0 && t < 2))) };
    },
  };
}
