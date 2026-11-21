import { styles, coreNames, shellNames, thicknessNames } from './recipe.mjs';

// Delivered finished-scene support on main, not the broader shell-preview
// matrix. B owns widening wax support after the provider handoff.
export function finishedSupport(recipe) {
  if (recipe.styleId === 'paw') return { supported: false, reason: '猫爪脆皮暂停制作。' };
  if (!styles.some(style => style.id === recipe.styleId) || !Object.hasOwn(coreNames, recipe.coreMaterial) || !Object.hasOwn(shellNames, recipe.shellMaterial)
    || recipe.shellMaterial === 'wax' && !Object.hasOwn(thicknessNames, recipe.waxThickness)) return { supported: false, reason: '此配方暂不可制作。' };
  if (recipe.shellMaterial === 'polish' || recipe.styleId === 'orb' && recipe.coreMaterial === 'clay') return { supported: true };
  return { supported: false, reason: '此蜡皮组合尚未接入成品。可改选指甲油，或圆球黏土。', owner: 'B' };
}
