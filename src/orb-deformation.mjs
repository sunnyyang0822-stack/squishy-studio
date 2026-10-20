// A bounded visual deformation, not a soft-body or shell fracture simulation.
// All positions are rebuilt from rest; normals are recomputed by the renderer.
export function createOrbDeformation(positions, normals, { reducedMotion = false } = {}) {
  const rest = positions.slice();
  const restNormals = normals.slice();
  const center = [0, 0, 1], targetCenter = [0, 0, 1];
  let active = false, held = 0, drag = 0, depth = 0, velocity = 0, dirty = false;
  const radius = .66;
  const copyPoint = (out, point) => { for (let i = 0; i < 3; i++) out[i] = point[i]; };
  function reset() {
    active = false; held = drag = depth = velocity = 0;
    positions.set(rest); dirty = true;
  }
  return {
    begin(point) {
      active = true; held = drag = 0;
      copyPoint(targetCenter, point);
      if (Math.abs(depth) < .001) copyPoint(center, point);
    },
    move(point, distance) { if (active) { copyPoint(targetCenter, point); drag = Math.min(1, Math.max(0, distance)); } },
    release() { active = false; },
    reset,
    setReducedMotion(value) { reducedMotion = value; velocity = 0; },
    getState() { return { active, held, drag, depth, velocity, center: [...center] }; },
    step(elapsed) {
      const dt = Math.min(.064, Math.max(0, elapsed));
      if (active) held += Math.max(0, elapsed);
      const target = active ? Math.min(.34, .17 + .15 * Math.min(held / .8, 1) + .06 * Math.min(drag / .5, 1)) : 0;
      const before = depth;
      let centerDelta = 0;
      for (let i = 0; i < 3; i++) {
        const delta = targetCenter[i] - center[i];
        centerDelta += delta * delta;
        center[i] += delta * (1 - Math.exp(-18 * dt));
      }
      if (reducedMotion) {
        depth += (target - depth) * (1 - Math.exp(-30 * dt));
      } else {
        // Spring preset: mass 1, stiffness 100, damping 10. Substeps keep it
        // stable on slow frames; rebound is capped to 0.012 model units.
        const steps = Math.max(1, Math.ceil(dt / .004));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          velocity += (100 * (target - depth) - 10 * velocity) * h;
          depth += velocity * h;
          if (depth < -.012 || depth > .36) { depth = Math.max(-.012, Math.min(.36, depth)); velocity = 0; }
        }
      }
      const moving = Math.abs(target - depth) > .0002 || Math.abs(velocity) > .003 || centerDelta > .000001;
      if (!moving) { depth = target; velocity = 0; copyPoint(center, targetCenter); }
      const changed = dirty || depth !== before || (depth !== 0 && centerDelta > 0);
      if (changed) {
        if (depth === 0) positions.set(rest);
        else for (let i = 0; i < positions.length; i += 3) {
          const distance = Math.hypot(rest[i] - center[0], rest[i + 1] - center[1], rest[i + 2] - center[2]);
          const q = distance / radius;
          // Smooth compact depression and a shallow surrounding lip. Both
          // displacement and slope go to zero at the edge of the neighborhood.
          const weight = q < 1 ? (1 - q * q) ** 2 * (1 - 2.2 * q * q) : 0;
          const offset = depth * weight;
          positions[i] = rest[i] - restNormals[i] * offset;
          positions[i + 1] = Math.max(-.905, rest[i + 1] - restNormals[i + 1] * offset);
          positions[i + 2] = rest[i + 2] - restNormals[i + 2] * offset;
        }
        dirty = false;
      }
      return { changed, atRest: depth === 0, needsFrame: moving || (active && held < .8) };
    },
  };
}
