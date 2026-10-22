// One color buffer for one mesh. Retarget from the currently visible colors,
// never from the previous selection, so rapid changes cannot flash or jump.
export function createOrbColor(colors, initial, { reducedMotion = false } = {}) {
  const from = colors.slice(), target = [...initial];
  let heights = new Float32Array(colors.length / 3), elapsed = 0, active = false;
  function fill() { for (let i = 0; i < colors.length; i++) colors[i] = target[i % 3]; }
  fill();
  return {
    select(rgb, nextHeights, { restart = false } = {}) {
      if (!restart && rgb.every((value, i) => value === target[i])) return false;
      from.set(colors); target.splice(0, 3, ...rgb);
      heights = nextHeights.slice(); elapsed = 0; active = true;
      return true;
    },
    setReducedMotion(value) {
      if (value === reducedMotion) return;
      reducedMotion = value;
      if (active) { from.set(colors); elapsed = 0; }
    },
    step(dt) {
      if (!active) return { changed: false, needsFrame: false };
      elapsed += Math.max(0, dt);
      const duration = reducedMotion ? .12 : .65;
      const progress = elapsed >= duration - 1e-9 ? 1 : elapsed / duration;
      for (let i = 0; i < colors.length; i += 3) {
        // A soft front traverses the current world's top to bottom. Height is
        // captured at selection, so the coating remains attached during orbit.
        const x = reducedMotion ? progress : Math.max(0, Math.min(1, (progress * 1.24 - (1 - heights[i / 3])) / .24));
        const blend = x * x * (3 - 2 * x);
        for (let k = 0; k < 3; k++) colors[i + k] = from[i + k] + (target[k] - from[i + k]) * blend;
      }
      if (progress === 1) { fill(); active = false; }
      return { changed: true, needsFrame: active, progress };
    },
  };
}
