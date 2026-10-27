// Geometry, tactile behavior and optical material have separate identities.
const names = { orb: '奶油圆球', cloud: '云朵', paw: '猫爪', cylinder: '圆柱', donut: '甜甜圈', pyramid: '三角锥', flower: '五瓣花朵', star: '五角星' };
export const squishyStyles = Object.freeze(Object.fromEntries(Object.entries(names).map(([id, name]) => [id, Object.freeze({
  id, name,
  modelUrl: `/assets/models/squishy-${id}.glb`,
  previewUrl: id === 'orb' ? '/assets/samples/cloud-preview.svg' : `/assets-source/squishy-${id}/preview.png`,
  meshName: id === 'orb' ? 'Orb_Surface' : 'Squishy_Surface',
  geometryAdapter: id === 'orb' ? 'radial' : 'surface',
  geometryOptions: Object.freeze(id === 'paw' ? { depthAxis: 2 } : {}),
  camera: Object.freeze(id === 'orb' ? [0, 1.6, 5] : [0, .9, 5]),
  supportedFeels: Object.freeze(['clay', 'marshmallow', 'slow-rebound']),
})])));
export function getSquishyStyle(id = 'orb') {
  if (!Object.hasOwn(squishyStyles, id)) throw new RangeError(`Unknown squishy style: ${id}`);
  return squishyStyles[id];
}
