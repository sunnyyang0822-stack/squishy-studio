import { createOrbDeformation } from './orb-deformation.mjs';

// Stable behavior IDs are independent of the model, color and optical material.
// Keep approved clay intact; future feels provide the same deformation API.
export const orbFeels = Object.freeze({
  clay: Object.freeze({
    id: 'clay',
    name: '黏土',
    createDeformation: createOrbDeformation,
  }),
});

export function getOrbFeel(id = 'clay') {
  if (!Object.hasOwn(orbFeels, id)) throw new RangeError(`Unknown orb feel: ${id}`);
  return orbFeels[id];
}
