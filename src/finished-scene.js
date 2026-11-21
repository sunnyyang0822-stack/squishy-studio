import { createModelPreview } from '../detail/adapters.js';
import { finishedConfig, supportsFinishedRecipe } from './finished-recipe.mjs';

// A owns page flow. This adapter owns only a finished scene and the existing
// prepare/commit/dispose coordination. Import directly as a browser ES module.
export function createFinishedScene(mount, { onUnavailable = () => {}, onEvent, onState = () => {} } = {}) {
  let disposed = false, revision = 0, pending, recipe, status = 'idle';
  const report = (state, error) => { status = state; onState({ state, recipe, error }); };
  const abortError = () => new DOMException('Aborted', 'AbortError');
  const renderer = createModelPreview(mount, {
    onUnavailable() {
      const error = Object.assign(new Error('成品场景暂不可用，请重试。'), { code: 'UNAVAILABLE' });
      pending?.reject(error); report('failed', error); onUnavailable(error);
    },
    onSceneEvent(event) {
      if (disposed) return;
      if (event.type === 'scene-ready' && pending?.key === event.recipeKey) { const request = pending; request.resolve(); report('ready'); }
      onEvent?.(event);
    },
  });
  async function update(value, { signal } = {}) {
    if (disposed || signal?.aborted) throw abortError();
    const config = finishedConfig(value); // Reject before touching the live scene.
    const ownRevision = ++revision;
    pending?.controller.abort(); pending?.reject(abortError());
    const controller = new AbortController();
    let resolve, reject;
    const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
    // A failure may arrive during prepare, before this method awaits ready.
    ready.catch(() => {});
    pending = { controller, resolve, reject, key: config.recipeKey };
    const abort = () => { controller.abort(); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
    renderer.stopInput(); report('loading');
    let handle;
    try {
      handle = await renderer.prepare(config, { signal: controller.signal });
      if (disposed || controller.signal.aborted || ownRevision !== revision) throw abortError();
      recipe = Object.freeze({ ...config.recipe });
      handle.commit();
      mount.querySelector('.orb-input')?.setAttribute('disabled', '');
      // Every initialize/open starts a complete product, even for the same
      // recipe as a previous, damaged scene. Updates never carry old damage.
      renderer.restore();
      await ready;
    } catch (error) {
      if (!disposed && ownRevision === revision && error.name !== 'AbortError') report('failed', error);
      else if (!disposed && ownRevision === revision) report('idle');
      throw error;
    } finally {
      handle?.dispose(); signal?.removeEventListener('abort', abort);
      if (ownRevision === revision) { pending = undefined; mount.querySelector('.orb-input')?.removeAttribute('disabled'); }
    }
  }
  return {
    supports: supportsFinishedRecipe,
    initialize: update, update,
    restore() { if (!disposed && !pending && status === 'ready') renderer.restore(); },
    stopInput() { if (!disposed) renderer.stopInput(); },
    getState() { return { state: status, recipe }; },
    dispose() {
      if (disposed) return;
      disposed = true; ++revision; pending?.controller.abort(); pending?.reject(abortError()); pending = undefined;
      renderer.dispose(); report('disposed');
    },
  };
}
