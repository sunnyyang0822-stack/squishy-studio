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

// Physical thickness and actual Voronoi partition size/placement differ.
// Contact timing, gap, fragment budgets and falling dynamics stay inherited.
const mediumWaxParameters = Object.freeze({ ...thinWaxParameters, thickness: thinWaxParameters.thickness * 2, seedCount: 96 });
const largeMediumWaxParameters = Object.freeze({ ...mediumWaxParameters, seedCount: 48, partitionSpace: 'surface' });
const pawMediumWaxParameters = Object.freeze({ ...largeMediumWaxParameters, seedCount: 32 });
const largePanelStyles = new Set(['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star']);
const mediumParametersForStyle = styleId => styleId === 'paw' ? pawMediumWaxParameters : largePanelStyles.has(styleId) ? largeMediumWaxParameters : mediumWaxParameters;
const mediumGeometryOptions = Object.freeze({ freezeRenderedFragments: true, detachedQueryHints: true, supportClusters: true, featureTieConsensus: true, fullSurfaceSupport: false });
const pawMediumGeometryOptions = Object.freeze({ ...mediumGeometryOptions, fullSurfaceSupport: true });
const mediumGeometryForStyle = styleId => styleId === 'paw' ? pawMediumGeometryOptions : mediumGeometryOptions;
const mediumWax = Object.freeze({
  id: 'medium-wax', material: 'wax', thickness: 'medium',
  parameters: mediumWaxParameters,
  parametersForStyle: mediumParametersForStyle,
  geometryOptions: mediumGeometryOptions,
  geometryOptionsForStyle: mediumGeometryForStyle,
  create(options = {}) {
    const { worldMatrix, ...shellOptions } = options;
    const profile = mediumGeometryForStyle(options.styleId);
    const wax = createThinWax({ ...shellOptions, ...profile, fullSurfaceSupport: options.fullSurfaceSupport || profile.fullSurfaceSupport, collectionEnabled: options.collectionEnabled ?? false }, mediumParametersForStyle(options.styleId));
    if (worldMatrix) wax.setWorldMatrix(worldMatrix);
    return wax;
  },
});

export const waxPresets = Object.freeze({ 'thin-wax': thinWax, 'medium-wax': mediumWax });

export function getWaxPreset(id = 'thin-wax') {
  if (!Object.hasOwn(waxPresets, id)) throw new RangeError('Unknown wax preset: ' + id);
  return waxPresets[id];
}
