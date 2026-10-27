import { createOrbDeformation } from './orb-deformation.mjs';
import { createSlowReboundDeformation } from './orb-slow-rebound.mjs';
import { createMarshmallowDeformation } from './orb-marshmallow.mjs';

// Stable behavior IDs are independent of the model, color and optical material.
// Keep approved clay intact; future feels provide the same deformation API.
export const orbFeels = Object.freeze({
  marshmallow: Object.freeze({ id: 'marshmallow', name: '棉花糖', createDeformation: createMarshmallowDeformation }),
  clay: Object.freeze({
    id: 'clay',
    name: '黏土',
    createDeformation: createOrbDeformation,
  }),
  'slow-rebound': Object.freeze({
    id: 'slow-rebound',
    name: '慢回弹',
    createDeformation: createSlowReboundDeformation,
  }),
});

export function getOrbFeel(id = 'clay') {
  if (!Object.hasOwn(orbFeels, id)) throw new RangeError(`Unknown orb feel: ${id}`);
  return orbFeels[id];
}
