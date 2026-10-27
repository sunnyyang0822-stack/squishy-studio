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

export const waxPresets = Object.freeze({ 'thin-wax': thinWax });

export function getWaxPreset(id = 'thin-wax') {
  if (!Object.hasOwn(waxPresets, id)) throw new RangeError('Unknown wax preset: ' + id);
  return waxPresets[id];
}
