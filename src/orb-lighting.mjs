// Presentation only: no influence on contact, pressure or recovery.
export function cavityVisibility(depth) {
  const displacement = Number.isFinite(depth) ? Math.max(0, depth) : 0;
  // A smooth falloff continues differentiating deep dents instead of clipping
  // all depths above .24 to the same flat shade. Keep pigment above 52%.
  return 1 - .48 * -Math.expm1(-displacement / .22);
}

export function getOrbLighting(daylight) {
  return daylight
    ? { fill: .72, front: .38, key: 3.15, rim: .65, environment: .25, exposure: 1.05 }
    : { fill: .62, front: .30, key: 3.2, rim: .72, environment: .21, exposure: .95 };
}
