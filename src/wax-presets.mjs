import { createThinWax, thinWaxParameters } from './thin-wax.mjs';

// Shell presets compose with an independently owned core and its existing input.
// Parameters stay owned by the verified implementation; no per-preset retuning.
const thinWax = Object.freeze({
  id: 'thin-wax', material: 'wax', thickness: 'thin',
  parameters: thinWaxParameters,
  create(options = {}) {
    const { worldMatrix, ...shellOptions } = options;
    const fragmentSize = ['paw', 'donut'].includes(options.styleId) ? 'small' : options.fragmentSize;
    const wax = createThinWax({ ...shellOptions, fragmentSize, collectionEnabled: options.collectionEnabled ?? false });
    if (worldMatrix) wax.setWorldMatrix(worldMatrix);
    return wax;
  },
});

// Only physical layer thickness and the actual Voronoi partition count differ.
// Contact timing, gap, fragment budgets and falling dynamics stay inherited.
const mediumWaxParameters = Object.freeze({ ...thinWaxParameters, thickness: thinWaxParameters.thickness * 2, seedCount: 96 });
const mediumWax = Object.freeze({
  id: 'medium-wax', material: 'wax', thickness: 'medium',
  parameters: mediumWaxParameters,
  create(options = {}) {
    const { worldMatrix, ...shellOptions } = options;
    const wax = createThinWax({ ...shellOptions, fullSurfaceSupport: options.fullSurfaceSupport || options.styleId === 'paw', collectionEnabled: options.collectionEnabled ?? false, freezeRenderedFragments: true }, mediumWaxParameters);
    if (worldMatrix) wax.setWorldMatrix(worldMatrix);
    return wax;
  },
});

export const waxPresets = Object.freeze({ 'thin-wax': thinWax, 'medium-wax': mediumWax });

export function getWaxPreset(id = 'thin-wax') {
  if (!Object.hasOwn(waxPresets, id)) throw new RangeError('Unknown wax preset: ' + id);
  return waxPresets[id];
}
