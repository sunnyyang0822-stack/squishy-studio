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

// Physical thickness and actual Voronoi partition size/placement differ.
// Contact timing, gap, fragment budgets and falling dynamics stay inherited.
// Surface seeds keep recessed regions moderate; 32/48 oversized cells were rejected.
const mediumWaxParameters = Object.freeze({ ...thinWaxParameters, thickness: thinWaxParameters.thickness * 2, seedCount: 96 });
const surfaceMediumWaxParameters = Object.freeze({ ...mediumWaxParameters, seedCount: 96, partitionSpace: 'surface' });
const pawMediumWaxParameters = Object.freeze({ ...surfaceMediumWaxParameters, seedCount: 128 });
const surfacePanelStyles = new Set(['cloud', 'paw', 'cylinder', 'donut', 'pyramid', 'flower', 'star']);
const mediumParametersForStyle = styleId => styleId === 'paw' ? pawMediumWaxParameters : surfacePanelStyles.has(styleId) ? surfaceMediumWaxParameters : mediumWaxParameters;
const mediumGeometryOptions = Object.freeze({ freezeRenderedFragments: true, detachedQueryHints: true, supportClusters: true, featureTieConsensus: true, fullSurfaceSupport: false, cacheAttachedPanels: false });
const optimizedMediumGeometryOptions = Object.freeze({ ...mediumGeometryOptions, performanceOptimizations: true });
const starMediumGeometryOptions = Object.freeze({ ...optimizedMediumGeometryOptions, attachedSupportPasses: 64 });
const pawMediumGeometryOptions = Object.freeze({ ...mediumGeometryOptions, fullSurfaceSupport: true });
const mediumGeometryForStyle = styleId => styleId === 'paw' ? pawMediumGeometryOptions : styleId === 'star' ? starMediumGeometryOptions : surfacePanelStyles.has(styleId) ? optimizedMediumGeometryOptions : mediumGeometryOptions;
const mediumWax = Object.freeze({
  id: 'medium-wax', material: 'wax', thickness: 'medium',
  name: '中蜡·双倍薄蜡厚度',
  parameters: mediumWaxParameters,
  parametersForStyle: mediumParametersForStyle,
  geometryOptions: mediumGeometryOptions,
  geometryOptionsForStyle: mediumGeometryForStyle,
  create(options = {}) {
    const { worldMatrix, ...shellOptions } = options;
    const profile = mediumGeometryForStyle(options.styleId);
    const wax = createWaxShell({ ...shellOptions, ...profile, fullSurfaceSupport: options.fullSurfaceSupport || profile.fullSurfaceSupport, collectionEnabled: options.collectionEnabled ?? false }, mediumParametersForStyle(options.styleId));
    if (worldMatrix) wax.setWorldMatrix(worldMatrix);
    return wax;
  },
});

// Model units, not optical material thickness. Gap and all behavior stay thin-wax.
export const thickWaxParameters = Object.freeze({ ...thinWaxParameters, thickness: thinWaxParameters.thickness * 3, seedCount: 36, maxInwardDeformation: .004 });
export const thickWaxSurfaceParameters = Object.freeze({ ...thickWaxParameters, surfaceContact: true });
// The torus needs surface-distance cells and a larger bounded collision solve.
// Neither changes the physical thickness or the shared fracture timing.
export const thickWaxDonutParameters = Object.freeze({ ...thickWaxSurfaceParameters, detachedCollisionIterations: 40, multiContactCollision: true });
const thickWaxMarshmallowDonutParameters = Object.freeze({ ...thickWaxDonutParameters, detachedCollisionIterations: 4, acceptVerifiedDebrisClearance: true });
const thickWax = Object.freeze({
  id: 'thick-wax', material: 'wax', thickness: 'thick',
  parameters: thickWaxParameters,
  create(options = {}) {
    const { worldMatrix, ...shellOptions } = options;
    const isDonut = options.styleId === 'donut';
    const donutParameters = options.feelId === 'marshmallow' ? thickWaxMarshmallowDonutParameters : thickWaxDonutParameters;
    const parameters = isDonut ? donutParameters : options.styleId && options.styleId !== 'orb' ? thickWaxSurfaceParameters : thickWaxParameters;
    const wax = createWaxShell({ ...shellOptions, compactPanels: isDonut || options.compactPanels, collectionEnabled: options.collectionEnabled ?? false }, parameters);
    if (worldMatrix) wax.setWorldMatrix(worldMatrix);
    return wax;
  },
});

export const waxPresets = Object.freeze({ 'thin-wax': thinWax, 'medium-wax': mediumWax, 'thick-wax': thickWax });

export function getWaxPreset(id = 'thin-wax') {
  if (!Object.hasOwn(waxPresets, id)) throw new RangeError('Unknown wax preset: ' + id);
  return waxPresets[id];
}
