import { createModelPreview } from '../detail/adapters.js';
import { feelFor } from './recipe.mjs';
import { finishedSupport } from './capabilities.mjs';
export { finishedSupport } from './capabilities.mjs';

function existingScene(mount, { mode, onUnavailable }) {
  const renderer = createModelPreview(mount, { onUnavailable });
  let handle, disposed = false;
  const update = async (recipe, { signal }) => {
    if (disposed || signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const feelId = feelFor(recipe.coreMaterial);
    const config = { ...recipe, presetId: feelId, feelId, appearanceId: feelId === 'slow-rebound' ? 'full-matte' : 'matte',
      mode, color: mode === 'core' ? recipe.coreColor : recipe.shellColor,
      // No shell is even allocated during the core trial.
      ...(mode === 'core' ? { shellMaterial: null, waxThickness: null } : {}),
      recipeKey: JSON.stringify(mode === 'core' ? [recipe.styleId, recipe.coreMaterial, recipe.coreColor] : recipe) };
    const next = await renderer.prepare(config, { signal });
    if (disposed || signal.aborted) { next.dispose(); throw new DOMException('Aborted', 'AbortError'); }
    next.commit(); handle?.dispose(); handle = next;
  };
  return { initialize: update, update,
    restore() { renderer.restore(); },
    stopInput() { renderer.stopInput(); },
    dispose() { if (!disposed) { disposed = true; handle?.dispose(); renderer.dispose(); } },
  };
}
export function createCoreScene(mount, options) {
  let scene, disposed = false;
  const update = (recipe, context) => {
    if (disposed) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    scene ||= existingScene(mount, { ...options, mode: 'core' });
    return scene.update(recipe, context);
  };
  return { initialize: update, update, stopInput() { scene?.stopInput(); },
    // Legacy rotation is document-scoped. Release that host when the separate
    // shell scene takes over, instead of leaving hidden listeners alive.
    suspend() { scene?.dispose(); scene = undefined; },
    dispose() { disposed = true; scene?.dispose(); scene = undefined; },
  };
}
export function createFinishedScene(mount, options) {
  const scene = existingScene(mount, { ...options, mode: 'shell' });
  const update = async (recipe, context) => {
    const support = finishedSupport(recipe);
    if (!support.supported) throw Object.assign(new Error(support.reason), { code: 'UNSUPPORTED' });
    return scene.update(recipe, context);
  };
  return { ...scene, initialize: update, update, supports: recipe => finishedSupport(recipe).supported };
}
// C and D supply their own implementations after the contract is confirmed.
// No dead sound/save controls are rendered before that handoff.
export const audioProvider = null;
export const worksProvider = null;
