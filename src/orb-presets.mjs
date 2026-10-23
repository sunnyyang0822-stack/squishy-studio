import { getOrbFeel } from './orb-feels.mjs';
import { createOrbMaterial } from './orb-optics.mjs';

// Ready-to-use bundles compose independent behavior, optics and presentation.
// Factories allocate fresh instance state/materials; the preset itself is immutable.
export const orbPresets = Object.freeze(Object.fromEntries(
  ['clay', 'marshmallow', 'slow-rebound'].map(id => {
    const feel = getOrbFeel(id);
    return [id, Object.freeze({
      id, name: feel.name, feelId: id,
      appearanceId: id === 'slow-rebound' ? 'full-matte' : 'matte',
      createDeformation: feel.createDeformation,
      createMaterial: source => createOrbMaterial(source, id),
    })];
  })
));

export function getOrbPreset(id = 'clay') {
  if (!Object.hasOwn(orbPresets, id)) throw new RangeError('Unknown orb preset: ' + id);
  return orbPresets[id];
}
