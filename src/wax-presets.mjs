import { createThinWax, createWaxShell, thinWaxParameters } from './thin-wax.mjs';

// Shell presets compose with an independently owned core and its existing input.
// Behavior parameters remain shared; each preset owns its geometry differences.
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

// Model units, not optical material thickness. Gap and all behavior stay thin-wax.
export const thickWaxParameters = Object.freeze({ ...thinWaxParameters, thickness: thinWaxParameters.thickness * 3, seedCount: 36 });
const thickWax = Object.freeze({
  id: 'thick-wax', material: 'wax', thickness: 'thick',
  parameters: thickWaxParameters,
  create(options = {}) {
    const { worldMatrix, ...shellOptions } = options;
    const wax = createWaxShell({ ...shellOptions, collectionEnabled: options.collectionEnabled ?? false }, thickWaxParameters);
    if (worldMatrix) wax.setWorldMatrix(worldMatrix);
    return wax;
  },
});

export const waxPresets = Object.freeze({ 'thin-wax': thinWax, 'thick-wax': thickWax });

export function getWaxPreset(id = 'thin-wax') {
  if (!Object.hasOwn(waxPresets, id)) throw new RangeError('Unknown wax preset: ' + id);
  return waxPresets[id];
}
