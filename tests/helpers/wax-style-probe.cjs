const assert = require('node:assert/strict');
const { installWaxGPUObserver } = require('./wax-upload-observer.cjs');
const regions = Object.freeze({
  orb: { target: [0, .03], region: 'front' },
  cloud: { target: [.4, .05], region: 'lobe connection' },
  paw: { target: [0, .17], region: 'palm-to-toe connection' },
  cylinder: { target: [.12, .12], region: 'curved front' },
  donut: { target: [.38, 0], region: 'inner wall', innerWall: true },
  pyramid: { target: [.15, -.25], region: 'sloping face' },
  flower: { target: [.55, .05], region: 'lobe connection' },
  star: { target: [.5, .15], region: 'arm connection' },
});
async function installWaxStyleProbe(page) {
  await installWaxGPUObserver(page);
  await page.addInitScript(() => {
    window.waxStyleObservers = new Set();
    const request = requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => request(t => { callback(t); for (const observer of [...window.waxStyleObservers]) observer(t); });
  });
}
async function projectedMeshContact(page, mesh, style, offset = [0, 0]) {
  const specification = regions[style];
  return page.evaluate(({ indices, specification, offset }) => {
    const p = window.styleProbe, m = p.mainMatrix, projection = p.projection;
    if (!m || !projection) throw Error('Actual rendered model-view/projection uniforms are required');
    const target = specification.target.map((v, k) => v + offset[k]); let best;
    for (let face = 0; face < indices.length; face += 3) {
      const point = [0, 0, 0], normal = [0, 0, 0];
      for (const id of indices.slice(face, face + 3)) for (let k = 0; k < 3; k++) { point[k] += p.rest[id * 3 + k] / 3; normal[k] += p.restNormals[id * 3 + k] / 3; }
      if (m[2] * normal[0] + m[6] * normal[1] + m[10] * normal[2] < .2) continue;
      const radialDot = point[0] * normal[0] + point[1] * normal[1];
      if (specification.innerWall && radialDot >= -.03) continue;
      const score = (point[0] - target[0]) ** 2 + (point[1] - target[1]) ** 2;
      if (!best || score < best.score) best = { face: face / 3, point, normal, radialDot, score };
    }
    if (!best || best.score > .08) throw Error('No visible real GLB face near requested structural region');
    const transform = (matrix, v) => [0, 1, 2, 3].map(k => matrix[k] * v[0] + matrix[k + 4] * v[1] + matrix[k + 8] * v[2] + matrix[k + 12] * v[3]);
    const clip = transform(projection, transform(m, [...best.point, 1])), box = document.querySelector('.toy-mount canvas').getBoundingClientRect();
    return { ...best, region: specification.region, x: box.x + (clip[0] / clip[3] + 1) * box.width / 2, y: box.y + (1 - clip[1] / clip[3]) * box.height / 2 };
  }, { indices: mesh.indices, specification, offset });
}
function geometryOK(d) {
  const g = d.geometry; assert.ok(g && g.attachedSamples > 0 && g.attachedSurfaceSamples > 0);
  assert.equal(g.attachedViolations, 0, JSON.stringify(g)); assert.equal(g.detachedViolations, 0, JSON.stringify(g));
  assert.ok(g.attachedMinGap >= g.gap - g.tolerance, JSON.stringify(g));
  assert.ok(g.attachedMinSignedDistance >= -g.tolerance, JSON.stringify(g));
  assert.ok(g.detachedMinSignedDistance === null || g.detachedMinSignedDistance >= -g.tolerance, JSON.stringify(g));
  assert.ok(g.maxThicknessError <= g.tolerance && g.thickness > 0, JSON.stringify(g));
  return g;
}
module.exports = { regions, installWaxStyleProbe, projectedMeshContact, geometryOK };
