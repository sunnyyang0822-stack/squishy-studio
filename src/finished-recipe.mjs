import { squishyStyles } from './squishy-styles.mjs';
import { orbColors } from '../detail/orb-colors.mjs';

export const finishedStyles = Object.freeze(Object.keys(squishyStyles).filter(id => id !== 'paw'));
const cores = Object.freeze({ clay: ['clay', 'matte'], marshmallow: ['marshmallow', 'matte'], butter: ['slow-rebound', 'full-matte'] });
const colors = new Set(orbColors.map(color => color.id));
const fields = ['styleId', 'coreMaterial', 'coreColor', 'shellMaterial', 'shellColor', 'waxThickness'];

// The version-1 effective recipe agreed with A. Never substitute another core,
// shape or a bare preview for an unsupported finished product.
export function supportsFinishedRecipe(recipe) {
  return Boolean(recipe && finishedStyles.includes(recipe.styleId) && Object.hasOwn(cores, recipe.coreMaterial)
    && colors.has(recipe.coreColor) && colors.has(recipe.shellColor)
    && (recipe.shellMaterial === 'wax' && ['thin', 'medium', 'thick'].includes(recipe.waxThickness)
      || recipe.shellMaterial === 'polish' && recipe.waxThickness === null));
}

export function finishedConfig(recipe) {
  if (!supportsFinishedRecipe(recipe)) throw Object.assign(new RangeError('此成品配方尚未支持；猫爪脆皮仍暂停。'), { code: 'UNSUPPORTED_RECIPE' });
  const effective = Object.fromEntries(fields.map(key => [key, recipe[key]]));
  const [feelId, appearanceId] = cores[recipe.coreMaterial];
  return { ...effective, recipe: effective, recipeKey: JSON.stringify(fields.map(key => effective[key])),
    presetId: feelId, feelId, appearanceId, color: recipe.coreColor,
    mode: 'finished', waxCollection: false };
}
