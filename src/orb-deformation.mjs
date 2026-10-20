// Bounded per-vertex visual deformation; retained dents live in model space.
export function createOrbDeformation(positions, normals, { reducedMotion = false } = {}) {
  const rest = positions.slice(), restNormals = normals.slice();
  const count = positions.length / 3;
  const offsets = new Float32Array(count), velocities = new Float32Array(count), retained = new Float32Array(count);
  const center = [0, 0, 1], targetCenter = [0, 0, 1];
  let active = false, held = 0, drag = 0, dirty = false;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const copyPoint = (out, point) => { for (let i = 0; i < 3; i++) out[i] = point[i]; };
  function cancel() {
    active = false; held = drag = 0;
    offsets.set(retained); velocities.fill(0); dirty = true;
    copyPoint(center, targetCenter);
  }
  return {
    begin(point) { active = true; held = drag = 0; copyPoint(center, point); copyPoint(targetCenter, point); },
    move(point, distance) { if (active) { copyPoint(targetCenter, point); drag = clamp(distance, 0, 1); } },
    release() {
      if (!active) return;
      active = false;
      // Keep one third of this stroke's current displacement. Repeated strokes
      // saturate safely rather than accumulating an unbounded deformation.
      for (let i = 0; i < count; i++) retained[i] = clamp(retained[i] + (offsets[i] - retained[i]) / 3, -.01, .22);
    },
    cancel,
    reset() { retained.fill(0); cancel(); },
    setReducedMotion(value) { reducedMotion = value; velocities.fill(0); },
    getState() { return { active, held, drag, depth: Math.max(...offsets), retainedDepth: Math.max(...retained), center: [...center] }; },
    step(elapsed) {
      const dt = clamp(elapsed, 0, .064);
      if (active) held += Math.max(0, elapsed);
      const strength = Math.min(.34, .17 + .15 * Math.min(held / .8, 1) + .06 * Math.min(drag / .5, 1));
      let centerDelta = 0;
      for (let k = 0; k < 3; k++) {
        const delta = targetCenter[k] - center[k]; centerDelta += delta * delta;
        center[k] += delta * (1 - Math.exp(-18 * dt));
      }
      let moving = false, changed = dirty, atRest = true;
      const steps = Math.max(1, Math.ceil(dt / .004)), h = dt / steps;
      for (let i = 0; i < count; i++) {
        const index = i * 3;
        const q = Math.hypot(rest[index] - center[0], rest[index + 1] - center[1], rest[index + 2] - center[2]) / .66;
        const weight = active && q < 1 ? (1 - q * q) ** 2 * (1 - 2.2 * q * q) : 0;
        const target = clamp(retained[i] + strength * weight, -.02, .36);
        const before = offsets[i];
        let offset = before, velocity = velocities[i];
        if (reducedMotion) offset += (target - offset) * (1 - Math.exp(-30 * dt));
        else for (let sub = 0; sub < steps; sub++) {
          velocity += (100 * (target - offset) - 10 * velocity) * h;
          offset += velocity * h;
          if (offset < -.02 || offset > .36) { offset = clamp(offset, -.02, .36); velocity = 0; }
        }
        if (Math.abs(target - offset) <= .0002 && Math.abs(velocity) <= .003) { offset = target; velocity = 0; }
        else moving = true;
        offsets[i] = offset; velocities[i] = velocity;
        changed ||= offsets[i] !== before;
        atRest &&= offsets[i] === 0;
      }
      if (changed) {
        for (let i = 0; i < count; i++) {
          const index = i * 3, offset = offsets[i];
          positions[index] = rest[index] - restNormals[index] * offset;
          positions[index + 1] = Math.max(-.905, rest[index + 1] - restNormals[index + 1] * offset);
          positions[index + 2] = rest[index + 2] - restNormals[index + 2] * offset;
        }
        dirty = false;
      }
      return { changed, atRest, needsFrame: moving || (active && (held < .8 || centerDelta > .000001)) };
    },
  };
}
