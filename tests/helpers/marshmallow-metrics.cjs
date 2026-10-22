const { modelAttribute } = require('./orb-probe.cjs');
module.exports = async function measure() {
  const { getOrbFeel } = await import('../../src/orb-feels.mjs');
  const rest = modelAttribute('POSITION'), normal = modelAttribute('NORMAL');
  const point = a => [Math.sin(a), .0175, Math.cos(a)];
  const sample = (p, a) => {
    const contact = point(a); let index = 0, nearest = Infinity;
    for (let i = 0; i < rest.length; i += 3) {
      const distance = Math.hypot(...contact.map((v, k) => v - rest[i + k]));
      if (distance < nearest) { nearest = distance; index = i; }
    }
    return { vertex: index / 3, rest: Array.from(rest.slice(index, index + 3)), depth: Math.hypot(...contact.map((_, k) => p[index + k] - rest[index + k])) };
  };
  const fixture = id => { const p = rest.slice(); return { p, d: getOrbFeel(id).createDeformation(p, normal) }; };
  const advance = (d, duration, hz = 120) => { for (let t = 0; t < duration - 1e-9; t += 1 / hz) d.step(Math.min(1 / hz, duration - t)); };
  const report = { units: 'model-space radial displacement; nearest original GLB vertex', parameters: { responsePerSecond: 360, maxDepth: .70, radialLimit: .76, footprintRadius: .66, pathSpacing: .04 }, curves: [], paths: [] };
  for (const seconds of [.004, 1 / 120, 1 / 60, .025, .05, .1, .5, 3]) {
    const row = { seconds };
    for (const id of ['clay', 'marshmallow']) { const f = fixture(id); f.d.begin(point(0)); advance(f.d, seconds); row[id] = sample(f.p, 0); }
    report.curves.push(row);
  }
  for (const duration of [.1, .6, 2]) for (const hz of [30, 60, 120]) for (const events of [2, 12, 60]) for (const dwell of [0, .3]) {
    const f = fixture('marshmallow'); f.d.begin(point(-1)); advance(f.d, dwell, hz);
    let next = 1;
    for (let t = 1 / hz; t < duration + 1 / hz - 1e-9; t += 1 / hz) {
      while (next <= events && next / events * duration <= t + 1e-9) { f.d.move(point(-1 + 2 * next / events), 1); next++; }
      f.d.step(Math.min(1 / hz, duration));
    }
    advance(f.d, dwell, hz);
    const samples = Array.from({ length: 9 }, (_, i) => sample(f.p, -1 + i / 4));
    f.d.release(); const frozen = f.p.slice(); advance(f.d, 10, hz);
    report.paths.push({ duration, hz, events, dwell, samples, maxDifference: Math.max(...samples.map(p => p.depth)) - Math.min(...samples.map(p => p.depth)), releaseDrift: Math.max(...f.p.map((v, i) => Math.abs(v - frozen[i]))) });
  }
  return report;
};
