// Optical/model presentation is independent of the deformation factory.
// Existing clay and marshmallow retain the exact original matte presentation.
export const orbAppearances = Object.freeze({
  matte: Object.freeze({ id: 'matte', scale: Object.freeze([1, 1, 1]), pigmentGain: 1 }),
  'full-matte': Object.freeze({ id: 'full-matte', scale: Object.freeze([1, 1, 1]), pigmentGain: .94 }),
});

export function getOrbAppearance(id = 'matte') {
  if (!Object.hasOwn(orbAppearances, id)) throw new RangeError(`Unknown orb appearance: ${id}`);
  return orbAppearances[id];
}

// Sculpted assets own their proportions. All orb feels now share the approved
// clay/marshmallow silhouette; full-matte pigment remains independent.
const sculptedScale = Object.freeze([1, 1, 1]);
export function getModelPresentationScale(appearance, geometryAdapter) {
  return geometryAdapter === 'surface' ? sculptedScale : appearance.scale;
}
