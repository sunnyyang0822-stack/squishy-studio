import { squishyStyles } from '../src/squishy-styles.mjs';
import { colorNames } from '../detail/orb-colors.mjs';

export const recipeVersion = 1;
export const styles = Object.freeze(Object.values(squishyStyles).filter(style => style.id !== 'paw'));
export const coreNames = Object.freeze({ clay: '黏土', marshmallow: '棉花糖', butter: '慢回弹' });
export const shellNames = Object.freeze({ wax: '蜡皮', polish: '指甲油' });
export const thicknessNames = Object.freeze({ thin: '薄', medium: '中', thick: '厚' });
export const defaultRecipe = Object.freeze({ styleId: 'orb', coreMaterial: 'clay', coreColor: 'rose', shellMaterial: 'wax', shellColor: 'rose', waxThickness: 'medium' });
export const feelFor = material => material === 'butter' ? 'slow-rebound' : Object.hasOwn(coreNames, material) ? material : 'clay';
const own = (set, value, fallback) => Object.hasOwn(set, value) ? value : fallback;
export function normalizeDraft(input = {}) {
  const selectedStyle = styles.find(style => style.id === (input.styleId || input.style));
  const styleId = selectedStyle?.id || 'orb';
  const shellMaterial = own(shellNames, input.shellMaterial, 'wax');
  const shellColors = {
    wax: own(colorNames, input.shellColors?.wax || input.waxColor, 'rose'),
    polish: own(colorNames, input.shellColors?.polish || input.polishColor, 'rose'),
  };
  if (Object.hasOwn(colorNames, input.shellColor)) shellColors[shellMaterial] = input.shellColor;
  return {
    styleId, coreMaterial: own(coreNames, input.coreMaterial, 'clay'),
    coreColor: own(colorNames, input.coreColor, 'rose'), shellMaterial, shellColors,
    waxThickness: own(thicknessNames, input.waxThickness, 'medium'),
  };
}
export function effectiveRecipe(draft) {
  return { styleId: draft.styleId, coreMaterial: draft.coreMaterial, coreColor: draft.coreColor,
    shellMaterial: draft.shellMaterial, shellColor: draft.shellColors[draft.shellMaterial],
    waxThickness: draft.shellMaterial === 'wax' ? draft.waxThickness : null };
}
export function readLocation(url) {
  const params = new URL(url).searchParams;
  const draft = normalizeDraft(Object.fromEntries(params));
  // A transition cannot be resumed from an unfinished animation on reload.
  const requestedStep = params.get('step');
  const step = requestedStep === 'making' ? 'shell' : ['core', 'shell', 'play'].includes(requestedStep) ? requestedStep : 'core';
  return { draft, step };
}
export function writeLocation(url, { draft, step }) {
  const target = new URL(url);
  target.search = new URLSearchParams({
    style: draft.styleId, step,
    coreMaterial: draft.coreMaterial, coreColor: draft.coreColor,
    shellMaterial: draft.shellMaterial, waxColor: draft.shellColors.wax,
    polishColor: draft.shellColors.polish, waxThickness: draft.waxThickness,
  }).toString();
  return target;
}
export function updateKind(before, after) {
  if (before.styleId !== after.styleId || before.coreMaterial !== after.coreMaterial) return 'scene';
  if (before.shellMaterial !== after.shellMaterial || before.waxThickness !== after.waxThickness) return 'shell';
  return before.coreColor !== after.coreColor || before.shellColor !== after.shellColor ? 'color' : 'none';
}
